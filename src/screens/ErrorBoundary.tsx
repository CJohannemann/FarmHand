import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * The difference between "the app broke" and a blank white screen.
 *
 * A render error anywhere in React unmounts the whole tree, and without this
 * the result is a white page with the real cause visible only in a console
 * nobody on a phone in a barn is going to open. That failure is also
 * invisible to whoever runs the server: there is no error reporting here, so
 * the only report that will ever exist is what the person standing there can
 * read off the screen and repeat.
 *
 * So the message is the product: say plainly that it broke, keep the detail
 * where it can be copied, and offer the one action that usually works.
 * Reloading is genuinely likely to help, because the records themselves are
 * in the local database rather than in the component state being thrown away.
 *
 * Still a class component: React has no hook equivalent of
 * componentDidCatch, and error boundaries remain the one thing function
 * components cannot express.
 */
interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Goes nowhere but the console today. When error reporting is added,
    // this is the one place that has to change.
    console.error('Unhandled error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <main className="screen">
        <h1>Farmhand Management</h1>
        <p className="error">Something went wrong and this screen stopped working.</p>
        <p className="muted">
          Your records are safe — they're stored on this device and on the
          server, not in the part that just failed.
        </p>

        <button className="primary" onClick={() => window.location.reload()}>
          Reload the app
        </button>

        {/* Collapsed rather than hidden: useless to most people, and the only
            thing that makes a bug report actionable when someone does hit it. */}
        <details style={{ marginTop: '1.5rem' }}>
          <summary className="muted">Technical detail</summary>
          <pre style={{
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontSize: '0.75rem', marginTop: '0.5rem',
          }}>
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
        </details>
      </main>
    )
  }
}
