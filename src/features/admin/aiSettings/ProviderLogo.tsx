/**
 * Brand-color provider logos. Sourced verbatim from the Jan AI repo at
 * `web-app/public/images/model-provider/<name>.svg` and copied into
 * `public/llm-logos/`. Rendered via `<img>` so the full provider palette
 * (Anthropic terra tile, Gemini gradient, OpenAI green field, Azure blue)
 * survives intact — these are full-color SVGs, not `currentColor` masks.
 *
 * Dark mode: the SVGs already include their own backgrounds and contrast,
 * so they render correctly on either theme without filtering. We wrap them
 * in a rounded container so the brand tile sits naturally next to text.
 */
export { LLMProviderLogo as ProviderLogo } from '@/components/ui/LLMProviderLogo';
