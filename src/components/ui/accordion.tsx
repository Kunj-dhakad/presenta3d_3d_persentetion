"use client"

import * as React from "react"
import { cn } from "cn"
import { Accordion as AccordionPrimitive } from "radix-ui"
import { FigAngleDown } from "@/components/workspace/figma-icons"

function Accordion({ ...props }: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />
}

function AccordionItem({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      // The design's section card: white, 15px corners, a 55px header.
      className={cn("overflow-hidden rounded-[15px] border border-black/10 bg-white", className)}
      {...props}
    />
  )
}

function AccordionTrigger({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/acc flex h-[53px] flex-1 items-center gap-[13px] pr-5 pl-2.5 text-left text-sm font-medium text-black outline-none transition-colors hover:bg-[#f8fbfd] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset data-[state=open]:bg-[#e6f9fe]",
          className
        )}
        {...props}
      >
        {children}
        <FigAngleDown className="size-3.5 shrink-0 text-black/80 transition-transform duration-200 group-data-[state=open]/acc:rotate-180" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
      {...props}
    >
      <div className={cn("p-[15px]", className)}>{children}</div>
    </AccordionPrimitive.Content>
  )
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger }
