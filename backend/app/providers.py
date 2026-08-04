"""Provider registry.

Every provider here speaks the OpenAI wire protocol for chat, so a single
`AsyncOpenAI` client with a swapped `base_url` covers all of them — no
per-vendor SDKs. The one wrinkle is embeddings: Hugging Face's router is
chat-only, so its entry sets `embed_wire="hf-pipeline"` and llm.py posts to
the feature-extraction endpoint over httpx (already shipped with `openai`).

Every non-OpenAI entry has a usable free tier except DeepSeek (pay-per-use,
cheap), which is why DeepSeek sits second-to-last in the try-order. Model ids
move fast, so each default below is overridable per provider via
`<NAME>_CHAT_MODEL` / `<NAME>_EMBED_MODEL` in .env; `docs` points at the
current model list.
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
    # "openai" -> POST {base_url}/embeddings; "hf-pipeline" -> the Hugging Face
    # feature-extraction pipeline (their OpenAI-compatible router is chat-only).
    embed_wire: str = "openai"
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
        # llama-3.3-70b was decommissioned; /models now lists gpt-oss-120b,
        # zai-glm-4.7 and gemma-4-31b.
        chat_model="gpt-oss-120b",
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
        # The global api.z.ai endpoint serves no embedding models — embedding-3
        # lives only on Zhipu's China endpoint (open.bigmodel.cn); see
        # zai-org/z-ai-sdk-python#67. Set ZAI_EMBED_MODEL only if that changes.
        embed_model=None,
        key_url="https://z.ai/manage-apikey/apikey-list",
        docs="https://docs.z.ai/guides/llm/glm-4.5",
        free_note="GLM flash models are free; chat only on the global endpoint",
    ),
    "mistral": ProviderSpec(
        name="mistral",
        label="Mistral",
        base_url="https://api.mistral.ai/v1",
        chat_model="mistral-small-latest",
        embed_model="mistral-embed",
        key_url="https://console.mistral.ai/api-keys",
        docs="https://docs.mistral.ai/getting-started/models/models_overview/",
        free_note="free experiment tier (1 req/s); also serves embeddings",
        embed_batch=64,
        sim=SimBand(0.55, 0.85, 0.60, 0.66),
    ),
    "sambanova": ProviderSpec(
        name="sambanova",
        label="SambaNova",
        base_url="https://api.sambanova.ai/v1",
        chat_model="Meta-Llama-3.3-70B-Instruct",
        embed_model="E5-Mistral-7B-Instruct",
        key_url="https://cloud.sambanova.ai/",
        docs="https://docs.sambanova.ai/cloud/docs/get-started/supported-models",
        free_note="free tier, very fast inference; also serves embeddings",
        embed_batch=32,
        # E5 family — same high similarity floor as NVIDIA's nv-embedqa-e5.
        sim=SimBand(0.60, 0.85, 0.63, 0.68),
    ),
    "cohere": ProviderSpec(
        name="cohere",
        label="Cohere",
        base_url="https://api.cohere.ai/compatibility/v1",
        chat_model="command-a-03-2025",
        embed_model="embed-v4.0",
        key_url="https://dashboard.cohere.com/api-keys",
        docs="https://docs.cohere.com/docs/models",
        free_note="free trial key (rate-limited); also serves embeddings",
        embed_batch=32,
        sim=SimBand(0.25, 0.65, 0.30, 0.38),
    ),
    "openrouter": ProviderSpec(
        name="openrouter",
        label="OpenRouter",
        base_url="https://openrouter.ai/api/v1",
        chat_model="nvidia/nemotron-3-super-120b-a12b:free",
        embed_model=None,  # aggregator serves chat only, no /embeddings
        key_url="https://openrouter.ai/keys",
        docs="https://openrouter.ai/models?max_price=0",
        free_note=":free models, 50 req/day unfunded; ids churn — override on 404",
    ),
    "huggingface": ProviderSpec(
        name="huggingface",
        label="Hugging Face",
        base_url="https://router.huggingface.co/v1",
        chat_model="meta-llama/Llama-3.3-70B-Instruct",
        embed_model="sentence-transformers/all-MiniLM-L6-v2",
        key_url="https://huggingface.co/settings/tokens",
        docs="https://huggingface.co/docs/inference-providers",
        free_note="free monthly inference credits; router picks a host per model",
        embed_batch=32,
        embed_wire="hf-pipeline",  # /v1 router is chat-only; see llm.py
        sim=SimBand(0.18, 0.60, 0.22, 0.30),
    ),
    "deepseek": ProviderSpec(
        name="deepseek",
        label="DeepSeek",
        base_url="https://api.deepseek.com/v1",
        chat_model="deepseek-chat",
        embed_model=None,  # chat/completions only
        key_url="https://platform.deepseek.com/api_keys",
        docs="https://api-docs.deepseek.com/quick_start/pricing",
        free_note="pay-per-use but cheap — kept after the free providers",
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
DEFAULT_ORDER: tuple[str, ...] = (
    "groq",
    "cerebras",
    "gemini",
    "nvidia",
    "zai",
    "mistral",
    "sambanova",
    "cohere",
    "openrouter",
    "huggingface",
    "deepseek",
    "openai",
)
