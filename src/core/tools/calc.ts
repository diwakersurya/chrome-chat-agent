// Safe arithmetic evaluator (recursive descent, no eval). Nano is unreliable at
// arithmetic, so the agent delegates it here.

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
}
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E }

export function calculate(expression: string): number {
  // small models phrase maths naturally: "17.5% of 2,340", "3 x 4", "10 divided by 4"
  const src = expression
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\bof\b|\btimes\b|×|(?<=[\d)\s])x(?=[\s\d(])/g, '*')
    .replace(/\bdivided by\b|÷/g, '/')
    .replace(/\bplus\b/g, '+')
    .replace(/\bminus\b/g, '-')
  const tokens = src.match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[a-z]+|\*\*|[-+*/%^()]/g)
  if (!tokens || tokens.join('') !== src.replace(/\s+/g, '')) throw new Error(`Cannot parse "${expression}"`)
  let i = 0
  const peek = () => tokens[i]
  const next = () => tokens[i++]

  const primary = (): number => {
    const t = next()
    if (t === undefined) throw new Error('Unexpected end of expression')
    if (t === '(') {
      const v = expr()
      if (next() !== ')') throw new Error('Missing )')
      return v
    }
    if (t === '-') return -unary()
    if (t === '+') return unary()
    if (/^[\d.]/.test(t)) return parseFloat(t)
    if (t in CONSTS) return CONSTS[t]!
    if (t in FUNCS) {
      if (next() !== '(') throw new Error(`Expected ( after ${t}`)
      const v = expr()
      if (next() !== ')') throw new Error('Missing )')
      return FUNCS[t]!(v)
    }
    throw new Error(`Unknown token "${t}"`)
  }
  const unary = (): number => {
    const base = primary()
    if (peek() === '^' || peek() === '**') {
      next()
      return base ** unary() // right-associative
    }
    if (peek() === '%' && (tokens[i + 1] === undefined || /[)+\-*/]/.test(tokens[i + 1]!))) {
      next()
      return base / 100 // "15%" as percentage
    }
    return base
  }
  const term = (): number => {
    let v = unary()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next()
      const r = unary()
      v = op === '*' ? v * r : op === '/' ? v / r : v % r
    }
    return v
  }
  const expr = (): number => {
    let v = term()
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term()
    return v
  }

  const v = expr()
  if (i !== tokens.length) throw new Error(`Unexpected "${tokens[i]}"`)
  if (!Number.isFinite(v)) throw new Error('Result is not a finite number')
  return v
}
