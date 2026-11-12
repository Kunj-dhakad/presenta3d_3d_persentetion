"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as SheetPrimitive } from "radix-ui"
import { FigClose } from "@/components/workspace/figma-icons"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

/** A right-side drawer: full height, slides in, closes on Escape and outside click. */
function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      {/* The design: the editor behind is slightly blurred and greyed. */}
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-[#0f172a]/15 supports-backdrop-filter:backdrop-blur-[1.5px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col bg-[#f4f8fb] text-sm text-foreground shadow-[-10px_0_70px_rgb(0_0_0/0.15)] outline-none sm:max-w-[420px] data-open:animate-in data-open:slide-in-from-right data-open:duration-300 data-closed:animate-out data-closed:slide-out-to-right data-closed:duration-200",
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close data-slot="sheet-close" asChild>
          <button type="button" className="absolute top-5 right-5 flex size-[26px] items-center justify-center rounded-lg border border-black/10 bg-[#f4f8fb] text-black/70 transition hover:bg-white hover:text-black focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <FigClose className="size-3.5" />
            <span className="sr-only">Close</span>
          </button>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex shrink-0 flex-col gap-1.5 border-b border-black/10 bg-white px-5 py-5 pr-16", className)} {...props} />
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("text-lg leading-[1.26] font-medium text-black", className)} {...props} />
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn("max-w-[311px] text-sm leading-[1.29] text-black/60", className)} {...props} />
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle }
