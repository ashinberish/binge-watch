import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout'
import { PlanPlaceholder } from '@/features/billing'

export const Route = createFileRoute('/_app/plan')({
  staticData: { theme: 'light' },
  component: PlanPage,
})

function PlanPage() {
  return (
    <>
      <PageHeader title="Your plan" />
      <PlanPlaceholder />
    </>
  )
}
