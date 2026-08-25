import React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const baseStyles = "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";
    
    const variants = {
      primary: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500",
      secondary: "bg-slate-800 text-white hover:bg-slate-900 focus-visible:ring-slate-600",
      danger: "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500",
      outline: "border border-slate-300 bg-transparent hover:bg-slate-100 text-slate-900",
      ghost: "hover:bg-slate-100 text-slate-700",
    };

    const sizes = {
      sm: "h-8 px-3 text-xs",
      md: "h-10 px-4 text-sm",
      lg: "h-12 px-6 text-base",
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
