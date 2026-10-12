import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Input } from '@nightreel/ui'
import { useForm } from 'react-hook-form'
import { FormActions, FormField } from '@/components/forms'
import { errorMessage } from '@/lib/api'
import { useLogin } from '../hooks/useAuth'
import { loginSchema, type LoginValues } from '../schemas'
import './AuthForms.css'

export interface LoginFormProps {
  onSuccess: () => void
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const loginMutation = useLogin()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = handleSubmit((values) => loginMutation.mutate(values, { onSuccess }))

  return (
    <form className="nr-auth-form" onSubmit={onSubmit} noValidate aria-label="Sign in">
      {loginMutation.isError ? (
        <p className="nr-auth-form__error" role="alert">
          {errorMessage(loginMutation.error, 'We could not sign you in. Try again.')}
        </p>
      ) : null}
      <FormField label="Email" error={errors.email?.message}>
        {(field) => <Input {...field} type="email" autoComplete="email" {...register('email')} />}
      </FormField>
      <FormField label="Password" error={errors.password?.message}>
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
        )}
      </FormField>
      <FormActions align="stretch">
        <Button type="submit" loading={loginMutation.isPending}>
          Sign in
        </Button>
      </FormActions>
    </form>
  )
}
