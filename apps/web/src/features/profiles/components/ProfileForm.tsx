import { zodResolver } from '@hookform/resolvers/zod'
import { AVATAR_COLORS } from '@nightreel/shared'
import { Avatar, Button, Checkbox, Input } from '@nightreel/ui'
import type { CSSProperties } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { FormActions, FormField } from '@/components/forms'
import { errorMessage, type ProfileRead } from '@/lib/api'
import { useCreateProfile } from '../api/profiles-api'
import { profileSchema, type ProfileValues } from '../schemas'
import './Profiles.css'

export interface ProfileFormProps {
  onCreated: (profile: ProfileRead) => void
  onCancel?: () => void
}

const COLOR_NAMES: Record<string, string> = {
  '#d32f23': 'Red',
  '#f5b841': 'Amber',
  '#5aa9ff': 'Blue',
  '#3fbf7f': 'Green',
  '#b07cff': 'Violet',
  '#ff8a3d': 'Orange',
}

export function ProfileForm({ onCreated, onCancel }: ProfileFormProps) {
  const createProfile = useCreateProfile()
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: '', avatar_color: AVATAR_COLORS[0], is_kids: false },
  })
  const [name, color] = useWatch({ control, name: ['name', 'avatar_color'] })

  const onSubmit = handleSubmit((values) => createProfile.mutate(values, { onSuccess: onCreated }))

  return (
    <form className="nr-profile-form" onSubmit={onSubmit} noValidate aria-label="Add profile">
      <div className="nr-profile-form__preview">
        <Avatar name={name || 'New profile'} color={color} size="lg" decorative />
      </div>
      {createProfile.isError ? (
        <p className="nr-profile-form__error" role="alert">
          {errorMessage(createProfile.error, 'We could not add this profile. Try again.')}
        </p>
      ) : null}
      <FormField label="Profile name" error={errors.name?.message}>
        {(field) => <Input {...field} autoComplete="off" {...register('name')} />}
      </FormField>
      <fieldset className="nr-profile-form__colors">
        <legend className="nr-profile-form__legend">Colour</legend>
        {AVATAR_COLORS.map((c) => (
          <label key={c} className="nr-swatch" style={{ '--nr-swatch': c } as CSSProperties}>
            <input
              type="radio"
              value={c}
              className="nr-swatch__input"
              {...register('avatar_color')}
            />
            <span className="nr-visually-hidden">{COLOR_NAMES[c] ?? c}</span>
          </label>
        ))}
      </fieldset>
      <Controller
        control={control}
        name="is_kids"
        render={({ field: { value, onChange, ...field } }) => (
          <Checkbox
            {...field}
            checked={value}
            onCheckedChange={(checked) => onChange(checked === true)}
            label="Kids profile"
          />
        )}
      />
      <FormActions>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" loading={createProfile.isPending}>
          Add profile
        </Button>
      </FormActions>
    </form>
  )
}
