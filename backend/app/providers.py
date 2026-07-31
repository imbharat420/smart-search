"""Provider registry.

Every provider here speaks the OpenAI wire protocol, so a single `AsyncOpenAI`
client with a swapped `base_url` covers all of them — no per-vendor SDKs.

All five non-OpenAI entries have a usable free tier. Model ids move fast, so
each default below is overridable per provider via `<NAME>_CHAT_MODEL` /
`<NAME>_EMBED_MODEL` in .env; `docs` points at the current model list.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import NamedTuple, Optional


class SimBand(NamedTuple):
    """Cosine-similarity calibration for one embedding family.

    `lo`/`hi` map raw similarity onto the friendly 0..0.98 "match %" chip;
    `min_product`/`min_policy` are the cutoffs below which a hit isn't a real
    match. Every embedding model sits in a different similarity range (e5-style
    models in particular have a high floor), which is why this is per provider
    rather than a global constant.
    """

    lo: float
    hi: float
    min_product: float
    min_policy: float


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    label: str
    base_url: str
    chat_model: str
    embed_model: Optional[str] = None  # None -> chat only, can't serve retrieval
    key_url: str = ""  # where to get a free key
    docs: str = ""  # current model list
    free_note: str = ""
    embed_batch: int = 64  # inputs per embeddings request
    needs_input_type: bool = False  # NVIDIA nv-embedqa* require input_type
    # Starting-point calibration — tune per catalogue with EMBED_SIM_* in .env.
    sim: SimBand = SimBand(0.16, 0.52, 0.20, 0.28)


PROVIDERS: dict[str, ProviderSpec] = {
    "groq": ProviderSpec(
        name="groq",
        label="Groq",
        base_url="https://api.groq.com/openai/v1",
        chat_model="llama-3.3-70b-versatile",
        embed_model=None,  # Groq serves no embedding models
        key_url="https://console.groq.com/keys",
        docs="https://console.groq.com/docs/models",
        free_note="free tier, generous rate limits, very fast",
    ),
    "cerebras": ProviderSpec(
        name="cerebras",
        label="Cerebras",
        base_url="https://api.cerebras.ai/v1",
        chat_model="llama-3.3-70b",
        embed_model=None,  # chat/completions only
        key_url="https://cloud.cerebras.ai/",
        docs="https://inference-docs.cerebras.ai/models/overview",
        free_note="free tier with a daily token allowance",
    ),
    "gemini": ProviderSpec(
        name="gemini",
        label="Google Gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        chat_model="gemini-2.5-flash",
        embed_model="gemini-embedding-001",
        key_url="https://aistudio.google.com/apikey",
        docs="https://ai.google.dev/gemini-api/docs/models",
        free_note="free tier via AI Studio; also serves embeddings",
        embed_batch=32,
        sim=SimBand(0.45, 0.80, 0.52, 0.60),
    ),
    "nvidia": ProviderSpec(
        name="nvidia",
        label="NVIDIA NIM",
        base_url="https://integrate.api.nvidia.com/v1",
        chat_model="meta/llama-3.3-70b-instruct",
        embed_model="nvidia/nv-embedqa-e5-v5",
        key_url="https://build.nvidia.com/",
        docs="https://build.nvidia.com/models",
        free_note="free credits on build.nvidia.com; also serves embeddings",
        embed_batch=32,
        needs_input_type=True,
        # e5 retrieval models have a high similarity floor (~0.6 for unrelated).
        sim=SimBand(0.60, 0.85, 0.63, 0.68),
    ),
    "zai": ProviderSpec(
        name="zai",
        label="Z.AI",
        base_url="https://api.z.ai/api/paas/v4",
        chat_model="glm-4.5-flash",
        embed_model="embedding-3",
        key_url="https://z.ai/manage-apikey/apikey-list",
        docs="https://docs.z.ai/guides/llm/glm-4.5",
        free_note="GLM flash models are free; also serves embeddings",
        embed_batch=32,
        sim=SimBand(0.35, 0.75, 0.40, 0.48),
    ),
    "openai": ProviderSpec(
        name="openai",
        label="OpenAI",
        base_url="https://api.openai.com/v1",
        chat_model="gpt-4o-mini",
        embed_model="text-embedding-3-small",
        key_url="https://platform.openai.com/api-keys",
        docs="https://platform.openai.com/docs/models",
        free_note="paid — kept last so free providers are tried first",
        embed_batch=64,
    ),
}

# Default try-order: free-and-fast first, embedding-capable next, paid last.
DEFAULT_ORDER: tuple[str, ...] = ("groq", "cerebras", "gemini", "nvidia", "zai", "openai")
