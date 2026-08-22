/**
 * Dense linear algebra: just enough to solve the homogeneous least-squares
 * problems the calibration pipeline needs, without pulling in a matrix library.
 *
 * Matrices are row-major `number[][]`.
 */

export type Mat = number[][];

export function matMul(a: Mat, b: Mat): Mat {
  const n = a.length;
  const m = b[0].length;
  const k = b.length;
  const out: Mat = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < k; p++) {
      const aip = a[i][p];
      if (aip === 0) continue;
      for (let j = 0; j < m; j++) out[i][j] += aip * b[p][j];
    }
  }
  return out;
}

export function transpose(a: Mat): Mat {
  const n = a.length;
  const m = a[0].length;
  const out: Mat = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out[j][i] = a[i][j];
  return out;
}

export function identity(n: number): Mat {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
}

/**
 * Symmetric eigen-decomposition via the cyclic Jacobi method.
 * Returns eigenvalues (ascending) and the matching eigenvectors as columns.
 */
export function jacobiEigen(input: Mat, sweeps = 64): { values: number[]; vectors: Mat } {
  const n = input.length;
  const a = input.map((row) => row.slice());
  let v = identity(n);

  for (let sweep = 0; sweep < sweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-24) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-18) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const values = a.map((row, i) => row[i]);
  const order = values.map((_, i) => i).sort((i, j) => values[i] - values[j]);
  const sortedValues = order.map((i) => values[i]);
  const vectors: Mat = Array.from({ length: n }, (_, r) => order.map((i) => v[r][i]));
  v = vectors;
  return { values: sortedValues, vectors };
}

/**
 * Solve `A x = 0` subject to |x| = 1 (total least squares).
 * Implemented as the eigenvector of AᵀA with the smallest eigenvalue.
 */
export function nullSpaceVector(a: Mat): number[] {
  const ata = matMul(transpose(a), a);
  const { vectors } = jacobiEigen(ata);
  return vectors.map((row) => row[0]);
}

/** Gaussian elimination with partial pivoting. Returns null if singular. */
export function solveLinear(a: Mat, b: number[]): number[] | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];

    const d = m[col][col];
    for (let j = col; j <= n; j++) m[col][j] /= d;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let j = col; j <= n; j++) m[r][j] -= f * m[col][j];
    }
  }
  return m.map((row) => row[n]);
}

/** Inverse of a 3x3 matrix; null when effectively singular. */
export function invert3(m: Mat): Mat | null {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  return [
    [A * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv],
    [B * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv],
    [C * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv],
  ];
}

export function apply3(m: Mat, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}
