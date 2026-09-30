import { expect, it } from 'vitest'
import { calculate } from './calc'

it('evaluates arithmetic with precedence, powers, functions and percent', () => {
  expect(calculate('2 + 3 * 4')).toBe(14)
  expect(calculate('(2 + 3) * 4')).toBe(20)
  expect(calculate('2 ^ 3 ^ 2')).toBe(512)
  expect(calculate('-2 ** 2')).toBe(-4)
  expect(calculate('sqrt(16) + abs(-3)')).toBe(7)
  expect(calculate('1,234 × 2')).toBe(2468)
  expect(calculate('200 * 15%')).toBe(30)
  expect(calculate('10 % 3')).toBe(1)
  expect(calculate('2 * pi')).toBeCloseTo(6.283, 3)
})

it('rejects anything that is not maths', () => {
  expect(() => calculate('alert(1)')).toThrow()
  expect(() => calculate('2 +')).toThrow()
  expect(() => calculate('1/0')).toThrow()
  expect(() => calculate('2 $ 3')).toThrow()
})
