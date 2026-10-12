import { Button, buttonVariants, Card, CardBody, CardFooter, CardHeader } from '@nightreel/ui'
import { Link } from '@tanstack/react-router'
import { errorMessage } from '@/lib/api'
import { useCreateExtensionCode } from '../api/extension-connect-api'
import { extensionCallbackUrl, isExtensionRedirect } from '../redirect'

export interface ConnectExtensionCardProps {
  /** `redirect_uri` from the URL, as the extension sent it. Validated here before use. */
  redirectUri: string | undefined
  /** The signed-in account's display name. */
  displayName: string | undefined
  /** Leaves the page for the extension. Defaults to replacing the current location. */
  onRedirect?: (url: string) => void
}

const leave = (url: string) => window.location.replace(url)

export function ConnectExtensionCard({
  redirectUri,
  displayName,
  onRedirect = leave,
}: ConnectExtensionCardProps) {
  const createCode = useCreateExtensionCode()

  if (!isExtensionRedirect(redirectUri)) {
    return (
      <Card elevation="raised" padding="lg" aria-labelledby="connect-title">
        <CardHeader
          id="connect-title"
          title="This link cannot connect the extension"
          description="Open the Nightreel extension and choose Sign in to try again."
        />
        <CardFooter>
          <Link to="/history" className={buttonVariants({ variant: 'secondary' })}>
            Back to Nightreel
          </Link>
        </CardFooter>
      </Card>
    )
  }

  const connect = () =>
    createCode.mutate(redirectUri, {
      onSuccess: ({ code }) => onRedirect(extensionCallbackUrl(redirectUri, code)),
    })

  return (
    <Card elevation="raised" padding="lg" aria-labelledby="connect-title">
      <CardHeader
        id="connect-title"
        title="Connect the Nightreel extension"
        description={displayName ? `Signed in as ${displayName}.` : undefined}
      />
      <CardBody>
        <p style={{ margin: 0 }}>
          The extension saves your progress as you watch and counts down to your next episode. You
          can sign it out at any time.
        </p>
        {createCode.isError ? (
          <p role="alert" style={{ margin: 'var(--nr-space-4) 0 0' }}>
            {errorMessage(createCode.error, 'Could not connect the extension. Try again.')}
          </p>
        ) : null}
      </CardBody>
      <CardFooter>
        <Link to="/history" className={buttonVariants({ variant: 'secondary' })}>
          Cancel
        </Link>
        <Button loading={createCode.isPending || createCode.isSuccess} onClick={connect}>
          Connect extension
        </Button>
      </CardFooter>
    </Card>
  )
}
