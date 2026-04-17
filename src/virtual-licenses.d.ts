declare module "virtual:licenses" {
  interface LicenseEntry {
    name: string;
    license: string;
    url?: string;
  }
  const licenses: LicenseEntry[];
  export default licenses;
}
