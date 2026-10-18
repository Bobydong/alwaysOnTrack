import { TextContainerProperty, ImageContainerProperty } from '@evenrealities/even_hub_sdk'
import type { GlassesPanel } from './glasses-view.ts'

// SDK 0.0.10 constructors preserve unknown properties. Never pass the preview
// model directly: native image containers cannot contain text/event/art fields.
export function nativeObjects(panels: GlassesPanel[]) {
  return { containerTotalNum: panels.length,
    textObject: panels.filter(p => !p.graphic).map(p => new TextContainerProperty({
      containerID: p.containerID, containerName: p.containerName,
      xPosition: p.xPosition, yPosition: p.yPosition, width: p.width, height: p.height,
      borderWidth: p.borderWidth, borderColor: p.borderColor, borderRadius: p.borderRadius,
      paddingLength: p.paddingLength, isEventCapture: p.isEventCapture, content: p.content,
    })),
    imageObject: panels.filter(p => p.graphic).map(p => new ImageContainerProperty({
      containerID: p.containerID, containerName: p.containerName,
      xPosition: p.xPosition, yPosition: p.yPosition, width: p.width, height: p.height,
    })),
  }
}
