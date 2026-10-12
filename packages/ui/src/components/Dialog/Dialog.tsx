import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../utils/cn'
import { IconButton } from '../IconButton'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export interface DialogContentProps extends Omit<
  ComponentProps<typeof DialogPrimitive.Content>,
  'title'
> {
  /** Required: every dialog needs an accessible title. */
  title: ReactNode
  description?: ReactNode
  /** Hide the visual title while keeping it for assistive tech. */
  hideTitle?: boolean
  /** Show the close (x) button. Default true. */
  showClose?: boolean
  size?: 'sm' | 'md'
}

export function DialogContent({
  title,
  description,
  hideTitle = false,
  showClose = true,
  size = 'md',
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="nr-dialog__scrim" />
      <DialogPrimitive.Content
        className={cn('nr-dialog', `nr-dialog--${size}`, className)}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
      >
        <div className="nr-dialog__header">
          <DialogPrimitive.Title
            className={cn('nr-dialog__title', hideTitle && 'nr-visually-hidden')}
          >
            {title}
          </DialogPrimitive.Title>
          {showClose ? (
            <DialogPrimitive.Close asChild>
              <IconButton icon="x" aria-label="Close" size="sm" />
            </DialogPrimitive.Close>
          ) : null}
        </div>
        {description ? (
          <DialogPrimitive.Description className="nr-dialog__description">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        <div className="nr-dialog__body">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('nr-dialog__footer', className)} {...props} />
}
