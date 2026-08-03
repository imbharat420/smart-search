"""Runtime settings, loaded from environment / .env."""
from __future__ import annotations

from typing import Optional

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

    # --- API keys (set as many as you like; all but OpenAI have free tiers) --
    groq_api_key: str = ""
    cerebras_api_key: str = ""
    gemini_api_key: str = ""
    nvidia_api_key: str = ""
    zai_api_key: str = ""
    openai_api_key: str = ""

    # --- Per-provider model overrides ("" -> registry default) --------------
    groq_chat_model: str = ""
    cerebras_chat_model: str = ""
    gemini_chat_model: str = ""
    nvidia_chat_model: str = ""
    zai_chat_model: str = ""
    openai_chat_model: str = ""

    gemini_embed_model: str = ""
    nvidia_embed_model: str = ""
    zai_embed_model: str = ""
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
