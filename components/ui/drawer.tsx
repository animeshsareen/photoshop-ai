"use client"

import * as React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Lightweight Drawer built on Radix Dialog (replaces vaul) maintaining similar API surface.

type DrawerDirection = "top" | "bottom" | "left" | "right"

interface DrawerRootProps extends React.ComponentProps<typeof Dialog.Root> {
  direction?: DrawerDirection
}

const Drawer = ({ direction = "bottom", ...props }: DrawerRootProps) => (
  <Dialog.Root {...props} data-slot="drawer" data-direction={direction}>
    {props.children}
  </Dialog.Root>
)

const DrawerTrigger = (props: React.ComponentProps<typeof Dialog.Trigger>) => (
  <Dialog.Trigger data-slot="drawer-trigger" {...props} />
)

const DrawerPortal = (props: React.ComponentProps<typeof Dialog.Portal>) => (
  <Dialog.Portal data-slot="drawer-portal" {...props} />
)

const DrawerClose = (props: React.ComponentProps<typeof Dialog.Close>) => (
  <Dialog.Close data-slot="drawer-close" {...props} />
)

const DrawerOverlay = ({ className, ...props }: React.ComponentProps<typeof Dialog.Overlay>) => (
  <Dialog.Overlay
    data-slot="drawer-overlay"
    className={cn(
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
      className
    )}
    {...props}
  />
)

interface DrawerContentProps extends React.ComponentProps<typeof Dialog.Content> {
  direction?: DrawerDirection
}

const directionClasses: Record<DrawerDirection,string> = {
  top: "inset-x-0 top-0 mb-24 max-h-[80vh] rounded-b-lg border-b data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top",
  bottom: "inset-x-0 bottom-0 mt-24 max-h-[80vh] rounded-t-lg border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
  right: "inset-y-0 right-0 w-3/4 border-l sm:max-w-sm data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
  left: "inset-y-0 left-0 w-3/4 border-r sm:max-w-sm data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left"
}

const DrawerContent = ({ className, children, direction = "bottom", ...props }: DrawerContentProps) => (
  <DrawerPortal>
    <DrawerOverlay />
    <Dialog.Content
      data-slot="drawer-content"
      data-direction={direction}
      className={cn(
        "group/drawer-content bg-background fixed z-50 flex h-auto flex-col shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
        directionClasses[direction],
        className
      )}
      {...props}
    >
      {direction === 'bottom' && (
        <div className="bg-muted mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full" />
      )}
      {children}
      <Dialog.Close className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-offset-2">
        <XIcon className="size-4" />
        <span className="sr-only">Close</span>
      </Dialog.Close>
    </Dialog.Content>
  </DrawerPortal>
)

const DrawerHeader = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    data-slot="drawer-header"
    className={cn("flex flex-col gap-0.5 p-4 md:gap-1.5", className)}
    {...props}
  />
)

const DrawerFooter = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div data-slot="drawer-footer" className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />
)

const DrawerTitle = ({ className, ...props }: React.ComponentProps<typeof Dialog.Title>) => (
  <Dialog.Title data-slot="drawer-title" className={cn("text-foreground font-semibold", className)} {...props} />
)

const DrawerDescription = ({ className, ...props }: React.ComponentProps<typeof Dialog.Description>) => (
  <Dialog.Description data-slot="drawer-description" className={cn("text-muted-foreground text-sm", className)} {...props} />
)

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription
}
