export type PasswordMeta = {
  length: number
  hasDigit: boolean
  hasLetter: boolean
  hasSpecial: boolean
}

export function computePasswordMeta(password: string): PasswordMeta {
  return {
    length: password.length,
    hasDigit: /\d/.test(password),
    hasLetter: /[A-Za-z]/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
  }
}

export function validatePassword(password: string) {
  const errors: string[] = []
  if (password.length < 8) errors.push("密码至少需要 8 位")
  if (password.length > 128) errors.push("密码不能超过 128 位")
  if (!/[A-Za-z]/.test(password)) errors.push("密码至少包含一个字母")
  if (!/\d/.test(password)) errors.push("密码至少包含一个数字")
  return {
    valid: errors.length === 0,
    errors,
    meta: computePasswordMeta(password),
  }
}
