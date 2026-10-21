import * as math from 'mathjs'

const EXPRESSION_SYNTAX_GROUPS = [
  {
    category: 'Syntax & Operators',
    items: [
      {
        name: 'Arithmetic Operators',
        syntax: '+  -  *  /  ^  %  !',
        expr: '(12 + 8) * 3 / 4 ^ 2 + 5!',
        desc: 'Addition, subtraction, multiplication, division, power, modulus, factorial',
      },
      {
        name: 'Element-wise Operators',
        syntax: '.*  ./  .^',
        expr: '[1, 2, 3] .* [4, 5, 6]',
        desc: 'Element-wise matrix multiplication, division, and exponentiation',
      },
      {
        name: 'Variables & Assignment',
        syntax: 'name = expr',
        expr: 'tax = 19%; price = 250; price * (1 + tax)',
        desc: 'Assign variables and chain multiple statements with ;',
      },
      {
        name: 'Custom Functions',
        syntax: 'f(x, y) = expr',
        expr: 'hypot2(a, b) = sqrt(a^2 + b^2); hypot2(3, 4)',
        desc: 'Define reusable single- or multi-parameter functions',
      },
      {
        name: 'Previous Result (ans)',
        syntax: 'ans',
        expr: 'ans * 2',
        desc: 'Reference the evaluated result from the previous line',
      },
      {
        name: 'Conditional Operator (Ternary)',
        syntax: 'condition ? trueExpr : falseExpr',
        expr: '15 > 10 ? 100 : 0',
        desc: 'Evaluate branches conditionally based on a boolean expression',
      },
      {
        name: 'Relational Operators',
        syntax: '==  !=  <  >  <=  >=',
        expr: '2^10 >= 1000',
        desc: 'Compare numbers, strings, units, or matrices',
      },
      {
        name: 'Logical Operators',
        syntax: 'and  or  xor  not',
        expr: '(5 > 3) and not(2 == 4)',
        desc: 'Boolean conjunction, disjunction, exclusive OR, and negation',
      },
      {
        name: 'Bitwise Operators',
        syntax: '&  |  ^|  ~  <<  >>  >>>',
        expr: '(0b1010 & 0b1100) | (1 << 4)',
        desc: 'Bitwise AND, OR, XOR (^|), NOT (~), and bit shifts',
      },
      {
        name: 'Ranges & Sequences',
        syntax: 'start:end  or  start:step:end',
        expr: '0:2:10',
        desc: 'Generate numeric ranges with optional step size',
      },
      {
        name: 'Matrices & Vectors',
        syntax: '[a, b; c, d]',
        expr: '[1, 2, 3; 4, 5, 6]',
        desc: 'Construct row vectors, column vectors, and 2D matrices',
      },
      {
        name: 'Matrix Transpose',
        syntax: "A'",
        expr: "[1, 2, 3; 4, 5, 6]'",
        desc: 'Conjugate transpose of a matrix or vector',
      },
      {
        name: 'Indexing & Slicing (1-based)',
        syntax: 'A[row, col]  or  A[1:end]',
        expr: '[10, 20, 30, 40, 50][2:end-1]',
        desc: '1-based indexing, submatrix ranges, and end keyword',
      },
      {
        name: 'Unit Conversion',
        syntax: 'value unit in targetUnit',
        expr: '100 km/h in m/s',
        desc: 'Convert between compatible units using "in" or "to"',
      },
      {
        name: 'Complex Numbers',
        syntax: 'a + bi',
        expr: '(2 + 3i) * (4 - i)',
        desc: 'Complex arithmetic with imaginary unit i',
      },
      {
        name: 'Number Radixes (Hex, Bin, Oct)',
        syntax: '0xff  0b1010  0o77',
        expr: '0xff + 0b1010 + 0o77',
        desc: 'Hexadecimal, binary, and octal literals with optional word size (i8, u32)',
      },
      {
        name: 'Scientific Notation',
        syntax: '1.23e-4  5e6',
        expr: '6.022e23 / 1e20',
        desc: 'Floating-point numbers with base-10 exponent',
      },
      {
        name: 'Objects & Properties',
        syntax: '{ key: value }  obj.key',
        expr: 'pt = {x: 3, y: 4}; sqrt(pt.x^2 + pt.y^2)',
        desc: 'Create key-value objects and access properties via dot or bracket notation',
      },
      {
        name: 'Strings & Manipulation',
        syntax: '"text"',
        expr: '"Mathematical"[1:4]',
        desc: 'String literals and character slicing',
      },
      {
        name: 'Comments',
        syntax: '# comment  or  // comment',
        expr: '42 * 2 // inline comment',
        desc: 'Full-line or inline comments using # or //',
      },
    ],
  },
]

const OVERRIDE_EXAMPLES = {
  add: '2.1 + 3.6',
  subtract: '5.3 - 2',
  multiply: '2.1 * 3.4',
  divide: '4.5 / 2',
  column: 'column([[1, 2], [3, 4]], 1)',
  concat: 'concat([1, 2; 5, 6], [3, 4; 7, 8])',
  count: 'count([1, 2, 3; 4, 5, 6])',
  ctranspose: 'ctranspose([1, 2, 3; 4, 5, 6])',
  diff: 'diff([1, 2, 4, 7, 0])',
  dotDivide: '[1, 2, 3; 4, 5, 6] ./ [2, 1, 1; 3, 2, 5]',
  dotMultiply: '[1, 2, 3; 4, 5, 6] .* [2, 1, 1; 3, 2, 5]',
  dotPow: '[1, 2, 3; 4, 5, 6] .^ 2',
  flatten: 'flatten([1, 2, 3; 4, 5, 6])',
  forEach: 'forEach([1, 2, 3], f(x) = x^2)',
  index: 'subset([10, 20, 30, 40], index(2:3))',
  lsolve: 'lsolve([-2, 0; 2, 1], [11, 9])',
  lsolveAll: 'lsolveAll([-2, 0; 2, 1], [11, 9])',
  lusolve: 'lusolve([-2, 3; 2, 1], [11, 9])',
  matrixFromFunction: 'matrixFromFunction([3, 3], f(i) = i[1] + i[2])',
  row: 'row([[1, 2], [3, 4]], 1)',
  solveODE: 'f(t, y) = y; solveODE(f, [0, 1], 1)',
  squeeze: 'squeeze([[1, 2, 3]])',
  subset: 'subset([1, 2; 3, 4], index(1, 2))',
  transpose: 'transpose([1, 2, 3; 4, 5, 6])',
  usolveAll: 'usolveAll([1, 1; 0, 1], [1; 2])',
  config: 'config()',
  typed: 'typeOf(42)',
  import: 'version',
  help: 'help("sin")',
}

const UNIT_DIMENSION_META = {
  LENGTH: { label: 'Length Units', example: '100 m in ft' },
  SURFACE: { label: 'Area / Surface Units', example: '1 hectare in acre' },
  VOLUME: { label: 'Volume Units', example: '1 gallon in L' },
  MASS: { label: 'Mass & Weight Units', example: '1 kg in lb' },
  TIME: { label: 'Time & Duration Units', example: '1 day in seconds' },
  FREQUENCY: { label: 'Frequency Units', example: '2.4 GHz in MHz' },
  ANGLE: { label: 'Angle Units', example: '180 deg in rad' },
  CURRENT: { label: 'Electric Current Units', example: '500 mA in A' },
  TEMPERATURE: { label: 'Temperature Units', example: '98.6 degF in degC' },
  AMOUNT_OF_SUBSTANCE: { label: 'Amount of Substance Units', example: '2 mol' },
  LUMINOUS_INTENSITY: { label: 'Luminous Intensity Units', example: '100 cd' },
  FORCE: { label: 'Force Units', example: '100 N in lbf' },
  ENERGY: { label: 'Energy Units', example: '1 kWh in J' },
  POWER: { label: 'Power Units', example: '1 hp in W' },
  PRESSURE: { label: 'Pressure Units', example: '1 atm in psi' },
  ELECTRIC_CHARGE: { label: 'Electric Charge Units', example: '10 C in A*s' },
  ELECTRIC_CAPACITANCE: { label: 'Electric Capacitance Units', example: '100 uF in F' },
  ELECTRIC_POTENTIAL: { label: 'Voltage / Potential Units', example: '230 V' },
  ELECTRIC_RESISTANCE: { label: 'Electric Resistance Units', example: '4.7 kohm in ohm' },
  ELECTRIC_INDUCTANCE: { label: 'Electric Inductance Units', example: '10 mH in H' },
  ELECTRIC_CONDUCTANCE: { label: 'Electric Conductance Units', example: '100 mS in S' },
  MAGNETIC_FLUX: { label: 'Magnetic Flux Units', example: '1 Wb in V*s' },
  MAGNETIC_FLUX_DENSITY: { label: 'Magnetic Flux Density Units', example: '1 T in Wb/m2' },
  BIT: { label: 'Digital Storage Units', example: '2.5 GB in MB' },
}

const CATEGORY_ORDER = [
  'Syntax & Operators',
  'Units & Prefixes',
  'Arithmetic',
  'Algebra',
  'Trigonometry',
  'Statistics',
  'Matrix',
  'Probability',
  'Combinatorics',
  'Complex',
  'Geometry',
  'Set',
  'Logical',
  'Bitwise',
  'Relational',
  'Special',
  'Signal',
  'Numeric',
  'Constants',
  'Physical Constants',
  'Construction',
  'Utils',
  'Operators',
  'Units',
  'Expression',
  'Core',
  'Type',
]

function cleanDescription(desc) {
  if (!desc) return ''
  const raw = Array.isArray(desc) ? desc.join(' ') : String(desc)
  const firstSentence = raw.replace(/\s+/g, ' ').trim().split(/\.\s/)[0]
  return firstSentence.endsWith('.') ? firstSentence : `${firstSentence}.`
}

function buildUnitItems() {
  const unitsByBase = {}
  const rawUnits = math.Unit?.UNITS || {}

  Object.entries(rawUnits).forEach(([unitName, info]) => {
    const baseKey = info?.base?.key || 'OTHER'
    if (!unitsByBase[baseKey]) unitsByBase[baseKey] = []
    unitsByBase[baseKey].push(unitName)
  })

  const items = Object.entries(unitsByBase).map(([baseKey, unitList]) => {
    const meta = UNIT_DIMENSION_META[baseKey] || {
      label: `${baseKey} Units`,
      example: `1 ${unitList[0]}`,
    }
    return {
      name: meta.label,
      syntax: '',
      expr: meta.example,
      desc: `Units (${unitList.length}): ${unitList.join(', ')}`,
    }
  })

  items.push({
    name: 'SI & Binary Prefixes',
    syntax: 'Metric (10^n) & Binary (2^10n)',
    expr: '5 GiB in MB',
    desc: 'Prefixes: y, z, a, f, p, n, u, m, c, d, da, h, k, M, G, T, P, E, Z, Y, Ki, Mi, Gi, Ti, Pi, Ei, Zi, Yi',
  })

  return items
}

let cachedCatalog = null

export function getSyntaxCatalog() {
  if (cachedCatalog) return cachedCatalog

  const categoryMap = new Map()
  EXPRESSION_SYNTAX_GROUPS.forEach((g) => {
    categoryMap.set(g.category, [...g.items])
  })

  categoryMap.set('Units & Prefixes', buildUnitItems())

  const seenNames = new Set()
  const mathKeys = [
    ...Object.keys(math),
    'true',
    'false',
    'null',
    'Infinity',
    'NaN',
    'import',
  ]

  for (const key of mathKeys) {
    if (
      key.endsWith('Dependencies') ||
      key.endsWith('Node') ||
      key.endsWith('Error') ||
      (key.startsWith('create') && key !== 'createUnit')
    ) {
      continue
    }

    let doc
    try {
      doc = math.help(key).toJSON()
    } catch {
      continue
    }
    if (!doc) continue

    const id = doc.name || key
    if (seenNames.has(id)) continue
    seenNames.add(id)

    const category = doc.category || 'Physical Constants'
    const examples = Array.isArray(doc.examples) ? doc.examples : []
    const expr =
      OVERRIDE_EXAMPLES[id] ||
      examples.find(
        (ex) =>
          !ex.includes('\n') &&
          ex.includes(id) &&
          !ex.startsWith('a =') &&
          !ex.startsWith('A =')
      ) ||
      examples.find((ex) => !ex.includes('\n')) ||
      id

    const syntaxStr =
      Array.isArray(doc.syntax) && doc.syntax.length > 0
        ? doc.syntax.join('  |  ')
        : id

    if (!categoryMap.has(category)) {
      categoryMap.set(category, [])
    }

    categoryMap.get(category).push({
      name: id,
      syntax: syntaxStr,
      expr,
      desc: cleanDescription(doc.description),
    })
  }

  // Sort items alphabetically inside each MathJS category (keep Syntax & Units in curated order)
  for (const [cat, list] of categoryMap.entries()) {
    if (cat !== 'Syntax & Operators' && cat !== 'Units & Prefixes') {
      list.sort((a, b) => a.name.localeCompare(b.name))
    }
  }

  const orderedGroups = []
  for (const cat of CATEGORY_ORDER) {
    if (categoryMap.has(cat)) {
      orderedGroups.push({
        category: cat,
        items: categoryMap.get(cat),
      })
      categoryMap.delete(cat)
    }
  }
  for (const [cat, items] of categoryMap.entries()) {
    orderedGroups.push({ category: cat, items })
  }

  cachedCatalog = orderedGroups
  return cachedCatalog
}
