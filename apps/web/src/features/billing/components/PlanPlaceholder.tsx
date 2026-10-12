import { Badge, Button, Card, CardBody, CardFooter, CardHeader } from '@nightreel/ui'

/**
 * Billing placeholder. Pricing and plan management ship in the last phase;
 * until then everyone is on the free beta.
 */
export function PlanPlaceholder() {
  return (
    <Card elevation="raised" aria-labelledby="plan-title">
      <CardHeader
        id="plan-title"
        title="Plans are coming soon"
        description="You are on the free beta."
        actions={<Badge variant="new">Beta</Badge>}
      />
      <CardBody>
        <p style={{ margin: 0 }}>
          Every Nightreel feature is included while we are in beta. When plans arrive, you will be
          able to compare them and manage yours here.
        </p>
      </CardBody>
      <CardFooter>
        <Button variant="secondary" disabled>
          Manage plan
        </Button>
      </CardFooter>
    </Card>
  )
}
