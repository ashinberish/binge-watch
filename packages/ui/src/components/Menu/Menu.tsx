import { DropdownMenu } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../../utils/cn'
import { Icon, type IconSource } from '../Icon'

export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger
export const MenuGroup = DropdownMenu.Group

export function MenuContent({
  className,
  sideOffset = 4,
  align = 'end',
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        className={cn('nr-menu', className)}
        sideOffset={sideOffset}
        align={align}
        {...props}
      />
    </DropdownMenu.Portal>
  )
}

export interface MenuItemProps extends ComponentProps<typeof DropdownMenu.Item> {
  icon?: IconSource
  tone?: 'default' | 'danger'
}

export function MenuItem({ icon, tone = 'default', className, children, ...props }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      className={cn('nr-menu__item', tone === 'danger' && 'nr-menu__item--danger', className)}
      {...props}
    >
      {icon ? <Icon icon={icon} size={16} /> : null}
      <span>{children}</span>
    </DropdownMenu.Item>
  )
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cn('nr-menu__label', className)} {...props} />
}

export function MenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cn('nr-menu__separator', className)} {...props} />
}
