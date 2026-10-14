"""Multi-provider chat + embeddings with automatic fallback.

One entry point each for streaming chat and embeddings. Both walk the provider
chain from config (`LLM_PROVIDER` first, then `LLM_FALLBACK`), skipping any
provider without a key, and move to the next one on failure — which is what
makes free tiers practical: a 429 on Groq just lands on Cerebras.

Because every provider in the registry is OpenAI-compatible, `AsyncOpenAI` with
a swapped `base_url` is the only client involved.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Callable, Optional

from .config import settings
from .providers import PROVIDERS, ProviderSpec, SimBand

log = logging.getLogger("smartsearch.llm")


class NoProviderConfigured(RuntimeError):
    """Nothing in the chain has an API key."""


class AllProvidersFailed(RuntimeError):
    """Every provider in the chain was tried and errored."""

    def __init__(self, attempts: list[tuple[str, str]]) -> None:
        self.attempts = attempts
        detail = "; ".join(f"{name}: {err}" for name, err in attempts)
        super().__init__(detail or "no provider available")


@dataclass(frozen=True)
class Provider:
    """A registry entry with its key and model ids resolved from settings."""

    spec: ProviderSpec
    api_key: str
    chat_model: str
    embed_model: Optional[str]

    @property
    def name(self) -> str:
        return self.spec.name

    @property
    def label(self) -> str:
        return self.spec.label

    @property
    def sim(self) -> SimBand:
        return settings.sim_band_for(self.spec.name)


# --- Chain resolution ------------------------------------------------------

def _resolve(name: str) -> Optional[Provider]:
    spec = PROVIDERS.get(name)
    if spec is None:
        return None
    key = settings.api_key_for(name)
    if not key:
        return None
    return Provider(
        spec=spec,
        api_key=key,
        chat_model=settings.chat_model_for(name),
        embed_model=settings.embed_model_for(name),
    )


def chat_providers() -> list[Provider]:
    """Configured providers in try-order."""
    return [p for p in (_resolve(n) for n in settings.provider_chain()) if p is not None]


def embed_providers() -> list[Provider]:
    """Configured providers that can also serve embeddings (Groq/Cerebras can't)."""
    return [p for p in chat_providers() if p.embed_model]


def missing_key_hint() -> str:
    """Human-readable 'here's how to configure me' line, free providers first."""
    names = [n for n in settings.provider_chain() if n != "openai"] or ["groq"]
    labels = ", ".join(PROVIDERS[n].label for n in names)
    return f"add a free API key for one of: {labels}"


# --- Clients ---------------------------------------------------------------

_clients: dict[str, Any] = {}


def client_for(provider: Provider):
    # max_retries=0: retrying a rate-limited provider in-place would delay the
    # fallback we already have. One shot each, then move down the chain.
    cache_key = f"{provider.name}|{provider.spec.base_url}|{provider.api_key[-8:]}"
    client = _clients.get(cache_key)
    if client is None:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            api_key=provider.api_key,
            base_url=provider.spec.base_url,
            timeout=settings.llm_timeout,
            max_retries=0,
        )
        _clients[cache_key] = client
    return client


def _brief(exc: Exception) -> str:
    text = str(exc).strip() or exc.__class__.__name__
    return text if len(text) <= 200 else text[:197] + "..."


# --- Cooldown ----------------------------------------------------------
# An account-level failure (bad/exhausted key, retired model) won't clear on
# its own retry — without this every turn re-discovers the same dead provider
# first, paying its round-trip before falling through to a live one.

_COOLDOWN_STATUSES = {401, 402, 404, 410}
_COOLDOWN_SECONDS = 600
_cooldown_until: dict[str, float] = {}


def _in_cooldown(name: str) -> bool:
    until = _cooldown_until.get(name)
    return until is not None and time.monotonic() < until


def _mark_cooldown(provider: Provider, exc: Exception) -> None:
    if getattr(exc, "status_code", None) in _COOLDOWN_STATUSES:
        _cooldown_until[provider.name] = time.monotonic() + _COOLDOWN_SECONDS


def _ordered(providers: list[Provider]) -> list[Provider]:
    """Drop providers currently in cooldown. If that would leave none at all
    (e.g. every provider cooling at once), try the full chain anyway rather
    than giving up early — a wrong cooldown must never be the reason chat
    stops working."""
    live = [p for p in providers if not _in_cooldown(p.name)]
    return live or providers


# --- Chat ------------------------------------------------------------------

async def stream_chat(
    messages: list[dict],
    *,
    temperature: Optional[float] = None,
    on_provider: Optional[Callable[[Provider], None]] = None,
) -> AsyncGenerator[str, None]:
    """Stream tokens from the first provider that answers.

    `on_provider` fires once, with the provider that produced the first token.
    A provider that fails *before* emitting anything is skipped silently; one
    that dies mid-reply raises, since restarting would duplicate text the
    client has already rendered.
    """
    providers = _ordered(chat_providers())
    if not providers:
        raise NoProviderConfigured(missing_key_hint())

    temp = settings.chat_temperature if temperature is None else temperature
    attempts: list[tuple[str, str]] = []

    for provider in providers:
        produced = False
        try:
            stream = await client_for(provider).chat.completions.create(
                model=provider.chat_model,
                messages=messages,
                stream=True,
                temperature=temp,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if not delta:
                    continue
                if not produced:
                    produced = True
                    log.info("chat served by %s (%s)", provider.label, provider.chat_model)
                    _cooldown_until.pop(provider.name, None)
                    if on_provider:
                        on_provider(provider)
                yield delta
        except Exception as exc:  # noqa: BLE001 — any failure means "try the next one"
            if produced:
                raise
            _mark_cooldown(provider, exc)
            attempts.append((provider.name, _brief(exc)))
            log.warning("chat provider %s failed, falling back: %s", provider.name, _brief(exc))
            continue

        if produced:
            return
        attempts.append((provider.name, "empty reply"))
        log.warning("chat provider %s returned an empty reply, falling back", provider.name)

    raise AllProvidersFailed(attempts)


# --- Embeddings ------------------------------------------------------------

async def embed(
    texts: list[str],
    *,
    provider: Optional[Provider] = None,
    input_type: str = "passage",
) -> tuple[Provider, list[list[float]]]:
    """Embed `texts`, returning the provider that served them plus the vectors.

    Pass `provider` to pin a specific one — vectors from different providers
    aren't comparable, so anything querying an existing index must reuse the
    provider that built it rather than falling through the chain.
    """
    chain = [provider] if provider is not None else _ordered(embed_providers())
    if not chain:
        raise NoProviderConfigured(
            "no embedding-capable provider configured "
            "(Gemini, NVIDIA NIM, Z.AI, Mistral, SambaNova, Cohere, Hugging Face "
            "or OpenAI — Groq, Cerebras, OpenRouter and DeepSeek are chat-only)"
        )

    attempts: list[tuple[str, str]] = []
    for candidate in chain:
        try:
            vectors = await _embed_with(candidate, texts, input_type)
        except Exception as exc:  # noqa: BLE001
            _mark_cooldown(candidate, exc)
            attempts.append((candidate.name, _brief(exc)))
            log.warning("embed provider %s failed: %s", candidate.name, _brief(exc))
            continue
        _cooldown_until.pop(candidate.name, None)
        return candidate, vectors

    raise AllProvidersFailed(attempts)


async def _embed_with(provider: Provider, texts: list[str], input_type: str) -> list[list[float]]:
    if provider.spec.embed_wire == "hf-pipeline":
        return await _embed_hf_pipeline(provider, texts)
    client = client_for(provider)
    batch = max(1, provider.spec.embed_batch)
    out: list[list[float]] = []
    for start in range(0, len(texts), batch):
        kwargs: dict[str, Any] = {
            "model": provider.embed_model,
            "input": texts[start : start + batch],
        }
        if provider.spec.needs_input_type:
            # nv-embedqa* reject a request without it, and score query vs
            # passage text differently.
            kwargs["extra_body"] = {"input_type": input_type, "truncate": "END"}
        resp = await client.embeddings.create(**kwargs)
        items = resp.data
        if all(item.index is not None for item in items):
            items = sorted(items, key=lambda d: d.index)
        out.extend(item.embedding for item in items)
    return out


async def _embed_hf_pipeline(provider: Provider, texts: list[str]) -> list[list[float]]:
    """Hugging Face's OpenAI-compatible router serves chat only, so embeddings
    go to the hf-inference feature-extraction pipeline instead. httpx already
    ships as the openai package's transport, so no new dependency is involved.

    The default model (sentence-transformers/*) returns one pooled vector per
    input; a raw transformer would return token-level vectors and won't work
    here — stick to sentence-transformers models for HUGGINGFACE_EMBED_MODEL.
    """
    import httpx

    url = (
        "https://router.huggingface.co/hf-inference/models/"
        f"{provider.embed_model}/pipeline/feature-extraction"
    )
    batch = max(1, provider.spec.embed_batch)
    out: list[list[float]] = []
    async with httpx.AsyncClient(timeout=settings.llm_timeout) as client:
        for start in range(0, len(texts), batch):
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {provider.api_key}"},
                json={"inputs": texts[start : start + batch]},
            )
            resp.raise_for_status()
            out.extend(resp.json())
    return out
