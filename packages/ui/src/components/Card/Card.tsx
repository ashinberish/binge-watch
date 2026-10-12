import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../utils/cn'

export const cardVariants = cva('nr-card', {
  variants: {
    elevation: {
      flat: 'nr-card--flat',
      raised: 'nr-card--raised',
    },
    padding: {
      none: 'nr-card--pad-none',
      md: 'nr-card--pad-md',
      lg: 'nr-card--pad-lg',
    },
  },
  defaultVariants: { elevation: 'flat', padding: 'md' },
})

export interface CardProps extends ComponentProps<'section'>, VariantProps<typeof cardVariants> {}

/** Container that gets its depth from surface steps, not borders. */
export function Card({ elevation, padding, className, ...props }: CardProps) {
  return <section className={cn(cardVariants({ elevation, padding }), className)} {...props} />
}

export interface CardHeaderProps extends Omit<ComponentProps<'header'>, 'title'> {
  title?: ReactNode
  description?: ReactNode
  /** Heading level for the title; defaults to h2. */
  headingLevel?: 2 | 3 | 4
  /** Right-aligned slot, e.g. a menu or badge. */
  actions?: ReactNode
}

export function CardHeader({
  title,
  description,
  headingLevel = 2,
  actions,
  className,
  children,
  ...props
}: CardHeaderProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <header className={cn('nr-card__header', className)} {...props}>
      <div className="nr-card__heading">
        {title ? <Heading className="nr-card__title">{title}</Heading> : null}
        {description ? <p className="nr-card__description">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="nr-card__actions">{actions}</div> : null}
    </header>
  )
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('nr-card__body', className)} {...props} />
}

export function CardFooter({ className, ...props }: ComponentProps<'footer'>) {
  return <footer className={cn('nr-card__footer', className)} {...props} />
}
