"use client"

import { format, isValid, parse } from "date-fns"
import { zhCN } from "date-fns/locale"
import ReactDatePicker from "react-datepicker"

const DATE_FORMAT = "yyyy-MM-dd"
const MONTH_FORMAT = "yyyy-MM"
const DATETIME_FORMAT = "yyyy-MM-dd'T'HH:mm"

function parseValue(value: string, valueFormat: string) {
  if (!value) return null

  const parsed = parse(value, valueFormat, new Date())
  return isValid(parsed) ? parsed : null
}

type CommonPickerProps = {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  ariaLabel?: string
  minDate?: Date
  maxDate?: Date
}

/** 基于 react-datepicker 的统一私有日期控件，不使用浏览器原生日期输入框。 */
export function DatePicker({
  value,
  onValueChange,
  disabled = false,
  ariaLabel = "日期",
  minDate,
  maxDate,
}: CommonPickerProps) {
  return (
    <ReactDatePicker
      selected={parseValue(value, DATE_FORMAT)}
      onChange={(nextDate: Date | null) =>
        onValueChange(nextDate ? format(nextDate, DATE_FORMAT) : "")
      }
      disabled={disabled}
      minDate={minDate}
      maxDate={maxDate}
      locale={zhCN}
      dateFormat="yyyy年MM月dd日"
      dateFormatCalendar="yyyy年MM月"
      placeholderText="选择日期"
      aria-label={ariaLabel}
      isClearable
      todayButton="今天"
      calendarClassName="app-date-picker__calendar"
      popperClassName="app-date-picker__popper"
      wrapperClassName="app-date-picker__wrapper"
      className="app-date-picker__input"
    />
  )
}

export function MonthPicker({
  value,
  onValueChange,
  disabled = false,
  ariaLabel = "出生年月",
}: CommonPickerProps) {
  return (
    <ReactDatePicker
      selected={parseValue(value, MONTH_FORMAT)}
      onChange={(nextMonth: Date | null) =>
        onValueChange(nextMonth ? format(nextMonth, MONTH_FORMAT) : "")
      }
      disabled={disabled}
      locale={zhCN}
      dateFormat="yyyy年MM月"
      placeholderText="选择出生年月"
      aria-label={ariaLabel}
      isClearable
      showMonthYearPicker
      showYearDropdown
      scrollableYearDropdown
      yearDropdownItemNumber={12}
      maxDate={new Date()}
      calendarClassName="app-date-picker__calendar"
      popperClassName="app-date-picker__popper"
      wrapperClassName="app-date-picker__wrapper"
      className="app-date-picker__input"
    />
  )
}

export function DateTimePicker({
  value,
  onValueChange,
  disabled = false,
  ariaLabel = "日期和时间",
}: CommonPickerProps) {
  return (
    <ReactDatePicker
      selected={parseValue(value, DATETIME_FORMAT)}
      onChange={(nextDate: Date | null) =>
        onValueChange(nextDate ? format(nextDate, DATETIME_FORMAT) : "")
      }
      disabled={disabled}
      locale={zhCN}
      dateFormat="yyyy年MM月dd日 HH:mm"
      dateFormatCalendar="yyyy年MM月"
      timeFormat="HH:mm"
      timeCaption="时间"
      timeIntervals={15}
      placeholderText="选择日期和时间"
      aria-label={ariaLabel}
      isClearable
      todayButton="此刻"
      showTimeSelect
      calendarClassName="app-date-picker__calendar app-date-picker__calendar--with-time"
      popperClassName="app-date-picker__popper"
      wrapperClassName="app-date-picker__wrapper"
      className="app-date-picker__input"
    />
  )
}
