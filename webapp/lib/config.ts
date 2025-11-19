type Config = {
  gatewayUrl: string
  appName: string
}

const config: Config = {
  gatewayUrl: process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:8080',
  appName: 'Record Platform',
}

export default config












