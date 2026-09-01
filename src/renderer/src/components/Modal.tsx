import { ReactNode, useEffect } from 'react'

interface ModalProps {
  title: string
  wide?: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ title, wide, onClose, children, footer }: ModalProps): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="ghost" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
