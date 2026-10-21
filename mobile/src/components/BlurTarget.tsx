import { createContext, useContext, useRef, type ComponentRef, type ReactNode, type RefObject } from 'react'
import { StyleSheet, View } from 'react-native'
import { BlurTargetView } from 'expo-blur'

type ViewElement = ComponentRef<typeof View>

export type GlassBlurTarget = RefObject<ViewElement | null>

const GlassBlurTargetContext = createContext<GlassBlurTarget | null>(null)

/**
 * Shared Android backdrop for the glass system. The expo-blur v58 API
 * requires a `blurTarget` ref before it will run a dimezis blur (it falls
 * back to "none" with a console warning otherwise), so the root layout
 * mounts one BlurTargetView around the app content and every GlassSurface
 * attaches its BlurView to it. On iOS BlurTargetView is a plain View, so
 * wrapping everything is harmless there.
 */
export function BlurTargetHost({ children }: { children: ReactNode }): React.JSX.Element {
  const targetRef = useRef<ViewElement | null>(null)
  return (
    <GlassBlurTargetContext.Provider value={targetRef}>
      <BlurTargetView ref={targetRef} style={styles.host}>
        {children}
      </BlurTargetView>
    </GlassBlurTargetContext.Provider>
  )
}

/** The shared blur target ref (Android), or undefined outside the host. */
export function useGlassBlurTarget(): GlassBlurTarget | undefined {
  const target = useContext(GlassBlurTargetContext)
  return target ?? undefined
}

const styles = StyleSheet.create({
  host: {
    flex: 1
  }
})
