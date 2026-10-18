import { createRoutePlanner } from './route-service.mjs'
import { ApiError, apiFailure, readJson, reply, sameOrigin } from './http.mjs'

export function plannerApi(options) {
  const planner = options.planner || createRoutePlanner(options)
  return async (req, res, next) => {
    const pathname = req.url?.split('?')[0]
    if (pathname !== '/api/trips/plan' && pathname !== '/api/trips/status') return next()
    try {
      if (pathname === '/api/trips/status') {
        if (req.method !== 'GET') throw new ApiError(405, 'GET required.')
        return reply(res, 200, await planner.status())
      }
      if (req.method !== 'POST') throw new ApiError(405, 'POST required.')
      sameOrigin(req)
      return reply(res, 200, await planner.plan(await readJson(req, 8192)))
    } catch (e) { apiFailure(res, e) }
  }
}
