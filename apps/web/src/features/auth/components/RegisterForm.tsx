import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Input } from '@nightreel/ui'
import { useForm } from 'react-hook-form'
import { FormActions, FormField } from '@/components/forms'
import { ApiError, errorMessage } from '@/lib/api'
import { useRegister } from '../hooks/useAuth'
import { registerSchema, type RegisterValues } from '../schemas'
import './AuthForms.css'

export interface RegisterFormProps {
  onSuccess: () => void
}

export function RegisterForm({ onSuccess }: RegisterFormProps) {
  const registerMutation = useRegister()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { display_name: '', email: '', password: '' },
  })

  const onSubmit = handleSubmit((values) =>
    registerMutation.mutate(values, {
      onSuccess,
      onError: (error) => {
        // Map 422 field errors from the API onto the form.
        if (error instanceof ApiError) {
          for (const [field, message] of Object.entries(error.fieldErrors)) {
            if (field in values) setError(field as keyof RegisterValues, { message })
          }
        }
      },
    }),
  )

  return (
    <form className="nr-auth-form" onSubmit={onSubmit} noValidate aria-label="Create your account">
      {registerMutation.isError ? (
        <p className="nr-auth-form__error" role="alert">
          {errorMessage(registerMutation.error, 'We could not create your account. Try again.')}
        </p>
      ) : null}
      <FormField label="Your name" error={errors.display_name?.message}>
        {(field) => <Input {...field} autoComplete="name" {...register('display_name')} />}
      </FormField>
      <FormField label="Email" error={errors.email?.message}>
        {(field) => <Input {...field} type="email" autoComplete="email" {...register('email')} />}
      </FormField>
      <FormField label="Password" hint="At least 8 characters." error={errors.password?.message}>
        {(field) => (
          <Input {...field} type="password" autoComplete="new-password" {...register('password')} />
        )}
      </FormField>
      <FormActions align="stretch">
        <Button type="submit" loading={registerMutation.isPending}>
          Create account
        </Button>
      </FormActions>
    </form>
  )
}
