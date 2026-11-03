export const ENV = {
  jwtSecret: process.env.JWT_SECRET ?? "",
  mongoUri: process.env.MONGODB_URI ?? "",
  adminEmail: process.env.ADMIN_EMAIL ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  adminName: process.env.ADMIN_NAME ?? "Admin",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // JulesBot: any OpenAI-compatible chat API (OpenAI, Gemini, Groq, OpenRouter...).
  llmApiUrl: process.env.LLM_API_URL ?? "",
  llmApiKey: process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "",
  // Folder on the Railway volume where uploaded/imported images are stored (e.g. /data/uploads).
  // When empty, images are stored in MongoDB instead.
  uploadDir: process.env.UPLOAD_DIR ?? "",
  // Claude vision names imported product photos (optional).
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
};
