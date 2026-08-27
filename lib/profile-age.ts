type ProfileFieldLike = { name: string }

const AGE_FIELD_NAME = "年龄"
const BIRTH_MONTH_FIELD_NAME = "出生年月"
const BIRTH_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

export function hasComputedProfileAge(fields: ProfileFieldLike[]) {
  const names = new Set(fields.map((field) => field.name))
  return names.has(AGE_FIELD_NAME) && names.has(BIRTH_MONTH_FIELD_NAME)
}

export function calculateAgeFromBirthMonth(
  birthMonth: unknown,
  today = new Date(),
) {
  const match = BIRTH_MONTH_PATTERN.exec(String(birthMonth ?? ""))
  if (!match) return null

  const birthYear = Number(match[1])
  const birthMonthNumber = Number(match[2])
  const age =
    today.getFullYear() -
    birthYear -
    (today.getMonth() + 1 < birthMonthNumber ? 1 : 0)

  return age >= 0 && age <= 150 ? age : null
}

export function applyComputedProfileAge(
  data: Record<string, unknown>,
  fields: ProfileFieldLike[],
  today = new Date(),
) {
  if (!hasComputedProfileAge(fields)) return data

  const dataWithoutManualAge = { ...data }
  delete dataWithoutManualAge[AGE_FIELD_NAME]
  const age = calculateAgeFromBirthMonth(
    data[BIRTH_MONTH_FIELD_NAME],
    today,
  )

  return age === null
    ? dataWithoutManualAge
    : { ...dataWithoutManualAge, [AGE_FIELD_NAME]: age }
}
