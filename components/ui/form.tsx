"use client"

import type * as React from "react"
import {
  FormProvider,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form"

type FormProps<TFieldValues extends FieldValues> =
  React.ComponentProps<"form"> & {
    form: UseFormReturn<TFieldValues>
  }

function Form<TFieldValues extends FieldValues>({
  form,
  children,
  ...props
}: FormProps<TFieldValues>) {
  return (
    <FormProvider {...form}>
      <form {...props}>{children}</form>
    </FormProvider>
  )
}

export { Form }
