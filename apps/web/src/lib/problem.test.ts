import { describe, expect, it } from 'vitest'
import { ApiError, errorMessage, unwrap } from './problem'

const response = (status: number) => new Response(null, { status })

describe('unwrap', () => {
  it('returns data on success', () => {
    expect(unwrap({ data: { id: 1 }, response: response(200) })).toEqual({ id: 1 })
  })

  it('throws ApiError with problem details', () => {
    const problem = {
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      detail: 'Wrong email or password.',
    }
    try {
      unwrap({ error: problem, response: response(401) })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(401)
      expect(errorMessage(e)).toBe('Wrong email or password.')
    }
  })

  it('maps 422 field errors', () => {
    const err = new ApiError(422, {
      title: 'Validation failed',
      errors: [{ loc: ['body', 'email'], msg: 'Enter a valid email', type: 'value_error' }],
    })
    expect(err.fieldErrors).toEqual({ email: 'Enter a valid email' })
  })
})

describe('errorMessage', () => {
  it('hides server errors behind friendly copy', () => {
    expect(errorMessage(new ApiError(503, { detail: 'db down' }))).toMatch(/trouble/)
    expect(errorMessage(new TypeError('fetch failed'))).toMatch(/connection/)
    expect(errorMessage('x')).toBe('Something went wrong. Try again.')
  })
})
