"""Runtime settings, loaded from environment / .env."""
from __future__ import annotations

from typing import Optional

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from .providers import PROVIDERS, DEFAULT_ORDER, SimBand


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Provider selection -------------------------------------------------
    # LLM_PROVIDER="auto" -> use the first provider in LLM_FALLBACK that has a
    # key. Name one (groq | cerebras | gemini | nvidia | zai | openai) to pin it
    # first; the rest of the chain still serves as fallback.
    llm_provider: str = "auto"
    llm_fallback: str = ",".join(DEFAULT_ORDER)
    llm_timeout: float = 30.0  # per request, seconds — stops a dead provider stalling the chain
    chat_temperature: float = 0.3

    # --- API keys (set as many as you like; all but OpenAI/DeepSeek have free
    # tiers). Mistral and Hugging Face accept the env names their own docs and
    # ecosystems hand out, so a pasted key works without renaming.
    groq_api_key: str = ""
    cerebras_api_key: str = ""
    gemini_api_key: str = ""
    nvidia_api_key: str = ""
    zai_api_key: str = ""
    mistral_api_key: str = Field(
        "", validation_alias=AliasChoices("MISTRAL_API_KEY", "MISTRAL_AI")
    )
    sambanova_api_key: str = ""
    cohere_api_key: str = ""
    openrouter_api_key: str = ""
    huggingface_api_key: str = Field(
        "",
        validation_alias=AliasChoices(
            "HUGGINGFACE_API_KEY", "HF_TOKEN", "HUGGINGFACEHUB_ACCESS_TOKEN"
        ),
    )
    deepseek_api_key: str = ""
    openai_api_key: str = ""

    # --- Per-provider model overrides ("" -> registry default) --------------
    groq_chat_model: str = ""
    cerebras_chat_model: str = ""
    gemini_chat_model: str = ""
    nvidia_chat_model: str = ""
    zai_chat_model: str = ""
    mistral_chat_model: str = ""
    sambanova_chat_model: str = ""
    cohere_chat_model: str = ""
    openrouter_chat_model: str = ""
    huggingface_chat_model: str = ""
    deepseek_chat_model: str = ""
    openai_chat_model: str = ""

    gemini_embed_model: str = ""
    nvidia_embed_model: str = ""
    zai_embed_model: str = ""
    mistral_embed_model: str = ""
    sambanova_embed_model: str = ""
    cohere_embed_model: str = ""
    huggingface_embed_model: str = ""
    openai_embed_model: str = ""

    # Pre-multi-provider names. Both only ever held OpenAI model ids, so they
    # stay wired to the OpenAI provider rather than leaking gpt-4o-mini onto Groq.
    chat_model: str = ""
    embed_model: str = ""

    # --- PostgreSQL ---------------------------------------------------------
    # Unset -> the whole app runs against the in-memory seed catalogue and
    # /health reports db="memory". That fallback is deliberate (BUILD-CONTRACT
    # section 5), not a shortcut: no Postgres should be needed to demo the POC.
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5433/smartsearch"  # postgresql+asyncpg://user:pass@host:5432/traveliq
    db_echo: bool = False  # log every statement — noisy, useful when a query misbehaves
    db_pool_size: int = 5

    # --- Retrieval tuning ---------------------------------------------------
    chat_top_k: int = 4  # trips fed to the model as context
    inline_products: int = 3  # trips surfaced as inline cards
    search_page_size: int = 12  # default page size when a request omits pageSize

    # --- Query understanding ------------------------------------------------
    # The NL parse sits in front of every search, so it gets a much tighter
    # deadline than a chat turn: miss it and nlq.py falls back to heuristics.
    nlq_timeout: float = 8.0
    nlq_cache_size: int = 256

    # --- Assistant: reranking and conversational state ----------------------
    # The rerank pass (rerank.py) scores a shortlist with the chat model, which
    # is a cross-encoder in the only sense that matters here: query and candidate
    # are attended together rather than embedded apart. It costs one extra
    # completion per chat turn, so it is a switch — off falls back to the
    # similarity order rag.py already produced, which is a documented degradation
    # rather than a broken feature.
    rerank_enabled: bool = True
    rerank_timeout: float = 12.0  # generous vs nlq: the traveller is already reading cards
    rerank_candidates: int = 24  # shortlist size; rerank.py caps at its own MAX_CANDIDATES

    # Raw dialogue turns sent alongside the plan state. Deliberately small: the
    # state IS the memory (see plan.py), and this window only carries tone and
    # "what did I just say" continuity. The pre-state code sent 8 and re-derived
    # the plan from scrollback on every turn.
    assistant_history_turns: int = 4

    # --- Observability: LangSmith tracing (tracing.py) -----------------------
    # A key switches per-turn pipeline traces on; unset means spans are still
    # built (they time the stages for metrics.py) but nothing leaves the process.
    # Uses the standard LANGSMITH_* names so a key from smith.langchain.com works
    # with no translation. The self-hosted/EU endpoint is an override away.
    langsmith_api_key: str = ""
    langsmith_project: str = "traveliq-assistant"
    langsmith_endpoint: str = "https://api.smith.langchain.com"

    # --- Catalogue merge thresholds -----------------------------------------
    # Match confidence at or above auto_merge_threshold merges without a human;
    # between review_floor and that it goes to the review queue; below, it is a
    # new trip. Mirrors AUTO_MERGE / REVIEW_FLOOR in ingest.py.
    auto_merge_threshold: float = 0.86
    review_floor: float = 0.60

    # Override the active provider's similarity calibration (see SimBand).
    # Leave unset to use the per-provider defaults in providers.py.
    embed_sim_lo: Optional[float] = None
    embed_sim_hi: Optional[float] = None
    embed_min_product_sim: Optional[float] = None
    embed_min_policy_sim: Optional[float] = None

    # CORS — the Vite dev server origins the browser will call from, plus the
    # 4173 pair that `vite preview` serves the production build on.
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]

    # --- Resolution helpers -------------------------------------------------

    def db_configured(self) -> bool:
        """True when a Postgres DSN is set. db.py and repository.py both check
        this before touching SQLAlchemy at all."""
        return bool(self.database_url.strip())

    def api_key_for(self, name: str) -> str:
        return (getattr(self, f"{name}_api_key", "") or "").strip()

    def chat_model_for(self, name: str) -> str:
        spec = PROVIDERS[name]
        override = (getattr(self, f"{name}_chat_model", "") or "").strip()
        if name == "openai":
            override = override or self.chat_model.strip()
        return override or spec.chat_model

    def embed_model_for(self, name: str) -> Optional[str]:
        spec = PROVIDERS[name]
        override = (getattr(self, f"{name}_embed_model", "") or "").strip()
        if name == "openai":
            override = override or self.embed_model.strip()
        return override or spec.embed_model

    def sim_band_for(self, name: str) -> SimBand:
        base = PROVIDERS[name].sim
        return SimBand(
            self.embed_sim_lo if self.embed_sim_lo is not None else base.lo,
            self.embed_sim_hi if self.embed_sim_hi is not None else base.hi,
            self.embed_min_product_sim if self.embed_min_product_sim is not None else base.min_product,
            self.embed_min_policy_sim if self.embed_min_policy_sim is not None else base.min_policy,
        )

    def provider_chain(self) -> list[str]:
        """Provider names in try-order — primary first, then the fallbacks."""
        order = [n.strip().lower() for n in self.llm_fallback.split(",")]
        primary = self.llm_provider.strip().lower()
        if primary and primary != "auto":
            order = [primary, *order]
        chain: list[str] = []
        for name in order:
            if name in PROVIDERS and name not in chain:
                chain.append(name)
        return chain

    def unknown_provider_names(self) -> list[str]:
        """Names in LLM_PROVIDER / LLM_FALLBACK that aren't in the registry."""
        raw = [self.llm_provider, *self.llm_fallback.split(",")]
        return [
            n.strip()
            for n in raw
            if n.strip() and n.strip().lower() not in PROVIDERS and n.strip().lower() != "auto"
        ]


settings = Settings()
