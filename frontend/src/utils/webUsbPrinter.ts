/**
 * WebUSB thermal printer support
 * ==============================
 * Lets the browser send raw ESC/POS bytes to a USB printer
 * (Chrome / Edge with WebUSB). User must grant permission once.
 *
 * Typical thermal printers use vendor class or serial-over-USB.
 * We try interface 0, endpoint OUT.
 */

interface WebUsbEndpoint {
  direction: 'in' | 'out'
  endpointNumber: number
}

interface WebUsbAlternate {
  endpoints: WebUsbEndpoint[]
}

interface WebUsbInterface {
  interfaceNumber: number
  alternates: WebUsbAlternate[]
}

interface WebUsbConfiguration {
  interfaces: WebUsbInterface[]
}

interface WebUsbDevice {
  opened: boolean
  configuration: WebUsbConfiguration | null
  productName?: string
  open(): Promise<void>
  selectConfiguration(configurationValue: number): Promise<void>
  claimInterface(interfaceNumber: number): Promise<void>
  transferOut(
    endpointNumber: number,
    data: BufferSource,
  ): Promise<unknown>
}

interface WebUsbRequestOptions {
  filters: Array<{
    classCode?: number
    vendorId?: number
  }>
}

interface WebUsbApi {
  requestDevice(options: WebUsbRequestOptions): Promise<WebUsbDevice>
  getDevices(): Promise<WebUsbDevice[]>
}

export interface WebUsbPrintResult {
  success: boolean
  message: string
  bytesSent?: number
}

function getUsb(): WebUsbApi | null {
  if (typeof navigator !== 'undefined' && 'usb' in navigator) {
    return (navigator as Navigator & { usb: WebUsbApi }).usb
  }
  return null
}

/**
 * Request user to pick a USB device (must be called from a click handler).
 */
export async function requestPrinter(): Promise<WebUsbDevice | null> {
  const usb = getUsb()

  if (!usb) {
    throw new Error('WebUSB is not supported in this browser (use Chrome/Edge)')
  }

  try {
    const device = await usb.requestDevice({
      filters: [
        // Common thermal printer vendor IDs (Epson, Star, generic)
        { classCode: 7 }, // printer class
        { vendorId: 0x04b8 }, // Epson
        { vendorId: 0x0519 }, // Star Micronics
        { vendorId: 0x0fe6 }, // ICS Advent / generic
        { vendorId: 0x154f }, // SII
      ],
    })

    return device
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return null
    }

    throw err
  }
}

/**
 * Send raw ESC/POS bytes to a previously granted USB device.
 */
export async function printViaWebUsb(
  data: BufferSource,
  device?: WebUsbDevice,
): Promise<WebUsbPrintResult> {
  const usb = getUsb()

  if (!usb) {
    return { success: false, message: 'WebUSB not supported' }
  }

  let dev = device

  if (!dev) {
    const devices = await usb.getDevices()
    dev = devices[0]
  }

  if (!dev) {
    // Prompt user
    dev = (await requestPrinter()) || undefined
  }

  if (!dev) {
    return { success: false, message: 'No USB printer selected' }
  }

  try {
    if (!dev.opened) {
      await dev.open()
    }

    if (dev.configuration === null) {
      await dev.selectConfiguration(1)
    }

    // Find an OUT endpoint
    let endpointNumber = 1
    const iface = dev.configuration?.interfaces[0]

    if (iface) {
      await dev.claimInterface(iface.interfaceNumber)

      const alt = iface.alternates[0]
      const outEp = alt?.endpoints.find(
        (endpoint: WebUsbEndpoint) => endpoint.direction === 'out',
      )

      if (outEp) {
        endpointNumber = outEp.endpointNumber
      }
    }

    let bytes: Uint8Array

    if (data instanceof Uint8Array) {
      bytes = data
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data)
    } else {
      const view = data as ArrayBufferView
      bytes = new Uint8Array(
        view.buffer,
        view.byteOffset,
        view.byteLength,
      )
    }

    await dev.transferOut(
      endpointNumber,
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    )

    return {
      success: true,
      message: `Sent ${bytes.length} bytes via WebUSB to ${dev.productName || 'printer'}`,
      bytesSent: bytes.length,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)

    return {
      success: false,
      message: `WebUSB print failed: ${message}`,
    }
  }
}

/**
 * Helper: decode base64 ESC/POS and print via WebUSB.
 */
export async function printEscPosBase64(
  base64: string,
): Promise<WebUsbPrintResult> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return printViaWebUsb(bytes)
}

export function isWebUsbAvailable(): boolean {
  return !!getUsb()
}
