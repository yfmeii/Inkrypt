import * as React from 'react'
import { CheckIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

interface CheckboxProps extends Omit<React.ComponentPropsWithoutRef<'input'>, 'type'> {
  checked?: boolean
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onChange, ...props }, ref) => (
    <label
      data-slot="checkbox"
      className={cn(
        'peer inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input shadow-xs transition-shadow outline-none focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        checked && 'border-primary bg-primary text-primary-foreground',
        className
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="sr-only"
        {...props}
      />
      {checked && <CheckIcon className="size-3.5" />}
    </label>
  )
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
