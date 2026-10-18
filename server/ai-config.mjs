export function agentOptions(env, planner) {
  const provider = env.AI_PROVIDER || (env.GROQ_API_KEY ? 'groq' : 'gemini')
  if (!['groq', 'gemini'].includes(provider)) throw new Error('AI_PROVIDER must be groq or gemini.')
  return { provider, planner,
    apiKey: provider === 'groq' ? env.GROQ_API_KEY : env.GEMINI_API_KEY,
    model: (provider === 'groq' ? env.GROQ_AGENT_MODEL : env.GEMINI_MODEL) || undefined,
    sttModel: provider === 'groq' ? env.GROQ_STT_MODEL || undefined : undefined,
  }
}
