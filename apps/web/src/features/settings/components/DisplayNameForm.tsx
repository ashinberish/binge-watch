import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Input, useToast } from '@nightreel/ui'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FormActions, FormField } from '@/components/forms'
import { errorMessage } from '@/lib/api'
import { useUpdateMe } from '../api/settings-api'

const schema = z.object({
  display_name: z.string().trim().min(1, 'Enter your name').max(50, 'Use 50 characters or fewer'),
})
type Values = z.infer<typeof schema>

export interface DisplayNameFormProps {
  /** Current display name; the form resets to it. */
  displayName: string
}

export function DisplayNameForm({ displayName }: DisplayNameFormProps) {
  const update = useUpdateMe()
  const { toast } = useToast()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema), values: { display_name: displayName } })

  const onSubmit = handleSubmit((values) =>
    update.mutate(values, {
      onSuccess: (user) => {
        reset({ display_name: user.display_name })
        toast({ title: 'Name updated', variant: 'success' })
      },
      onError: (error) =>
        toast({
          title: 'Could not save your name',
          description: errorMessage(error),
          variant: 'danger',
        }),
    }),
  )

  return (
    <form onSubmit={onSubmit} noValidate style={{ display: 'grid', gap: 16 }}>
      <FormField
        label="Display name"
        hint="Shown in the extension and on your account."
        error={errors.display_name?.message}
      >
        {(field) => <Input {...field} autoComplete="name" {...register('display_name')} />}
      </FormField>
      <FormActions>
        <Button type="submit" disabled={!isDirty} loading={update.isPending}>
          Save changes
        </Button>
      </FormActions>
    </form>
  )
}
