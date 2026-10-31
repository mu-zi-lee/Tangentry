import { forwardRef, useEffect, useImperativeHandle, useRef, useId, type DialogHTMLAttributes } from 'react'
import { Button } from '../button'
import './dialog.css'

interface DialogProps extends DialogHTMLAttributes<HTMLDialogElement> {
  title?: string
  closeDisabled?: boolean
}

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(
  ({ open, onClose, onCancel, onKeyDown, title, children, className = '', closeDisabled = false, ...props }, ref) => {
    const localRef = useRef<HTMLDialogElement>(null)
    const titleId = useId()
    useImperativeHandle(ref, () => localRef.current!, [])

    useEffect(() => {
      if (open === undefined) return
      const node = localRef.current
      if (!node) return
      if (!open) {
        if (node.open) node.close()
        return
      }
      const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (!node.open) node.showModal()
      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        if (node.open) node.close()
        document.body.style.overflow = previousOverflow
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
      }
    }, [open])

    return <dialog
      {...props}
      ref={localRef}
      className={['ui-dialog', title && 'ui-dialog-framed', className].filter(Boolean).join(' ')}
      aria-labelledby={props['aria-labelledby'] ?? (title ? titleId : undefined)}
      onClose={event => { if (!event.currentTarget.open) onClose?.(event) }}
      onCancel={event => { if (closeDisabled) event.preventDefault(); onCancel?.(event) }}
      onKeyDown={event => {
        onKeyDown?.(event)
        if (event.defaultPrevented || event.key !== 'Tab') return
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')]
          .filter(node => node.tabIndex >= 0 && !node.matches(':disabled, [inert], [inert] *') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden')
        const first = focusable[0]
        if (!first) { event.preventDefault(); event.currentTarget.focus(); return }
        // WebKit's system keyboard-navigation setting may skip buttons, so
        // own the whole modal tab order rather than only wrapping its ends.
        event.preventDefault()
        const current = focusable.indexOf(document.activeElement as HTMLElement)
        const next = current < 0 ? event.shiftKey ? focusable.length - 1 : 0
          : (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length
        focusable[next].focus()
      }}
    >
      {title ? <>
        <div className="ui-dialog-header">
          <h2 id={titleId}>{title}</h2>
          <Button type="button" variant="quiet" iconOnly aria-label="关闭" disabled={closeDisabled} onClick={() => localRef.current?.close()}>×</Button>
        </div>
        <div className="ui-dialog-content">{children}</div>
      </> : children}
    </dialog>
  }
)

Dialog.displayName = 'Dialog'
