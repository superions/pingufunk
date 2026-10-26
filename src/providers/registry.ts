import type { ContentProvider, ProviderStatus, ProviderCountry } from "@/types/provider";

/**
 * Provider Registry
 *
 * Central registry for managing content providers.
 * Handles provider registration, initialization and status. Search consumers use
 * the shared content-search coordinator and its source adapters.
 */
class ProviderRegistry {
  private providers: Map<string, ContentProvider> = new Map();
  private initialized = false;
  private initializing: Promise<void> | null = null;

  /**
   * Register a provider
   * @param provider The provider instance to register
   */
  register(provider: ContentProvider): void {
    if (this.providers.has(provider.id)) {
      console.warn(`[ProviderRegistry] Provider ${provider.id} already registered, replacing`);
    }
    this.providers.set(provider.id, provider);
    console.log(`[ProviderRegistry] Registered provider: ${provider.id} (${provider.name})`);
  }

  /**
   * Initialize all registered providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializing) return this.initializing;
    this.initializing = this.initializeAll();
    await this.initializing;
  }

  private async initializeAll(): Promise<void> {
    console.log(`[ProviderRegistry] Initializing ${this.providers.size} providers...`);

    const initPromises = Array.from(this.providers.values()).map(async (provider) => {
      try {
        await provider.initialize();
      } catch {
        console.error(`[ProviderRegistry] Failed to initialize ${provider.id}`);
      }
    });

    await Promise.all(initPromises);
    this.initialized = true;
    console.log(`[ProviderRegistry] All providers initialized`);
  }

  /**
   * Get a provider by ID
   * @param id Provider ID
   * @returns The provider or undefined if not found
   */
  getProvider(id: string): ContentProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): ContentProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all enabled providers
   */
  async getEnabledProviders(): Promise<ContentProvider[]> {
    const providers = this.getAllProviders();
    const enabledChecks = await Promise.all(
      providers.map(async (p) => ({ provider: p, enabled: await p.isEnabled() }))
    );
    return enabledChecks.filter((c) => c.enabled).map((c) => c.provider);
  }

  /**
   * Get providers by country
   * @param country Country code
   */
  getProvidersByCountry(country: ProviderCountry): ContentProvider[] {
    return this.getAllProviders().filter((p) => p.country === country);
  }

  /**
   * Get status of all providers
   */
  async getProvidersStatus(): Promise<Record<string, ProviderStatus & { enabled: boolean }>> {
    await this.ensureInitialized();

    const statuses: Record<string, ProviderStatus & { enabled: boolean }> = {};

    for (const provider of this.providers.values()) {
      try {
        const [status, enabled] = await Promise.all([provider.checkStatus(), provider.isEnabled()]);
        statuses[provider.id] = { ...status, enabled };
      } catch {
        statuses[provider.id] = {
          available: false,
          lastCheck: Date.now(),
          error: "Provider status check failed",
          enabled: false,
        };
      }
    }

    return statuses;
  }

  /**
   * Get provider info for display
   */
  getProviderInfo(): Array<{
    id: string;
    name: string;
    country: ProviderCountry;
    capabilities: ContentProvider["capabilities"];
  }> {
    return this.getAllProviders().map((p) => ({
      id: p.id,
      name: p.name,
      country: p.country,
      capabilities: p.capabilities,
    }));
  }

  /**
   * Ensure the registry is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// Singleton instance
export const providerRegistry = new ProviderRegistry();

/**
 * Register a provider with the global registry
 */
export function registerProvider(provider: ContentProvider): void {
  providerRegistry.register(provider);
}

/**
 * Initialize the provider registry
 * Should be called at application startup
 */
export async function initializeProviders(): Promise<void> {
  await providerRegistry.initialize();
}
