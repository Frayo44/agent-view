/**
 * OpenTUI JSX type declarations
 * These extend SolidJS JSX with OpenTUI-specific elements
 */

import type { RGBA } from "@opentui/core"
import type { JSX as SolidJSX } from "solid-js"

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      box: BoxProps
      text: TextProps
      scrollbox: ScrollBoxProps
      input: InputProps
      span: SpanProps
    }

    interface BoxProps {
      children?: SolidJSX.Element | SolidJSX.Element[] | string
      id?: string
      ref?: (el: any) => void
      flexDirection?: "row" | "column"
      flexGrow?: number
      flexShrink?: number
      alignItems?: "flex-start" | "flex-end" | "center" | "stretch"
      justifyContent?: "flex-start" | "flex-end" | "center" | "space-between" | "space-around"
      width?: number | string
      height?: number | string
      maxWidth?: number
      maxHeight?: number
      minWidth?: number
      minHeight?: number
      padding?: number
      paddingTop?: number
      paddingBottom?: number
      paddingLeft?: number
      paddingRight?: number
      margin?: number
      marginTop?: number
      marginBottom?: number
      marginLeft?: number
      marginRight?: number
      gap?: number
      position?: "relative" | "absolute"
      left?: number
      right?: number
      top?: number
      bottom?: number
      backgroundColor?: RGBA | string
      borderColor?: RGBA
      overflow?: "visible" | "hidden"
      onMouseUp?: (e: any) => void
      onMouseDown?: (e: any) => void
      onMouseOver?: () => void
      onMouseMove?: () => void
    }

    interface TextProps {
      children?: SolidJSX.Element | SolidJSX.Element[] | string | number
      ref?: (el: any) => void
      fg?: RGBA | string
      bg?: RGBA | string
      attributes?: number
      flexGrow?: number
      flexShrink?: number
      overflow?: "visible" | "hidden"
      wrapMode?: "word" | "none"
      paddingLeft?: number
      paddingRight?: number
      marginLeft?: number
      marginRight?: number
      onMouseUp?: () => void
    }

    interface SpanProps {
      children?: SolidJSX.Element | SolidJSX.Element[] | string | number
      style?: {
        fg?: RGBA | string
        bg?: RGBA | string
        attributes?: number
      }
    }

    interface ScrollBoxProps {
      children?: SolidJSX.Element | SolidJSX.Element[] | string
      ref?: (el: any) => void
      flexGrow?: number
      height?: number
      maxHeight?: number
      paddingLeft?: number
      paddingRight?: number
      scrollbarOptions?: {
        visible?: boolean
      }
    }

    interface InputProps {
      ref?: (el: any) => void
      value?: string
      placeholder?: string
      onInput?: (value: string) => void
      onReturn?: () => void
      flexGrow?: number
      focusedBackgroundColor?: RGBA
      cursorColor?: RGBA
      focusedTextColor?: RGBA
    }
  }
}

export {}
