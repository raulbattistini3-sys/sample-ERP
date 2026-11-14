package com.simple_erp.billing.network;

import java.net.InetAddress;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.server.context.WebServerInitializedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * With NETWORK_URL and NETWORK_TOKEN, billing announces itself on the network service as "billing" at the
 * port it actually bound (a development port move included) and keeps that alive with a heartbeat; the API
 * then finds it by name instead of BILLING_URL. Without them nothing here runs.
 */
@Configuration
public class NetworkConfig {

	private static final Logger log = LoggerFactory.getLogger(NetworkConfig.class);

	private static final long HEARTBEAT_SECONDS = 5;

	@Bean
	NetworkHolder networkHolder(Environment env) {
		String url = env.getProperty("NETWORK_URL", "").trim();
		String token = env.getProperty("NETWORK_TOKEN", "");
		return new NetworkHolder(url.isEmpty() || token.isEmpty() ? null : new NetworkClient(url, token));
	}

	@Bean
	ApplicationListener<WebServerInitializedEvent> networkRegistration(NetworkHolder holder, Environment env) {
		return (event) -> {
			NetworkClient network = holder.client();
			if (network == null || event.getApplicationContext().getParent() != null) {
				return;
			}
			int port = event.getWebServer().getPort();
			String host = env.getProperty("NETWORK_ADVERTISE_HOST", "127.0.0.1").trim();
			String id = instanceId(env);
			Map<String, Object> registration = new LinkedHashMap<>();
			registration.put("address", "https://" + (host.contains(":") ? "[" + host + "]" : host) + ":" + port);
			registration.put("health", "/actuator/health");
			registration.put("version", env.getProperty("spring.application.version", "dev"));
			registration.put("meta", Map.of("protocol", "https", "env", env.getProperty("BILLING_ENV", "")));
			registration.put("ttlSeconds", 3 * HEARTBEAT_SECONDS);
			holder.start(id, registration);
		};
	}

	static String instanceId(Environment env) {
		String fixed = env.getProperty("NETWORK_INSTANCE_ID", "").trim();
		if (!fixed.isEmpty()) {
			return fixed;
		}
		String host;
		try {
			host = InetAddress.getLocalHost().getHostName();
		}
		catch (Exception error) {
			host = "host";
		}
		host = host.replaceAll("[^A-Za-z0-9-]", "-");
		if (host.length() > 24) {
			host = host.substring(0, 24);
		}
		byte[] suffix = new byte[4];
		new java.security.SecureRandom().nextBytes(suffix);
		return "billing-" + host + "-" + HexFormat.of().formatHex(suffix);
	}

	/** The client (or null) plus the heartbeat; deregisters when the context closes. */
	public static final class NetworkHolder implements AutoCloseable {

		private final NetworkClient client;

		private ScheduledExecutorService beats;

		private String id;

		private volatile Boolean ok;

		NetworkHolder(NetworkClient client) {
			this.client = client;
		}

		public NetworkClient client() {
			return this.client;
		}

		synchronized void start(String id, Map<String, Object> registration) {
			if (this.beats != null) {
				return;
			}
			this.id = id;
			this.beats = Executors.newSingleThreadScheduledExecutor(Thread.ofVirtual().name("network-heartbeat").factory());
			this.beats.scheduleAtFixedRate(() -> {
				try {
					this.client.register("billing", id, registration);
					if (!Boolean.TRUE.equals(this.ok)) {
						log.info("network: registered as billing/{} at {}", id, registration.get("address"));
					}
					this.ok = true;
				}
				catch (Exception error) {
					if (!Boolean.FALSE.equals(this.ok)) {
						log.warn("network: registration failed; retrying: {}", error.getMessage());
					}
					this.ok = false;
				}
			}, 0, HEARTBEAT_SECONDS, TimeUnit.SECONDS);
		}

		@Override
		public synchronized void close() {
			if (this.beats == null) {
				return;
			}
			this.beats.shutdownNow();
			this.beats = null;
			try {
				this.client.deregister("billing", this.id);
			}
			catch (Exception ignored) {
				// the TTL forgets us anyway
			}
		}

	}

}
