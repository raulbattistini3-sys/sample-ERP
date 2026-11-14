package com.simple_erp.billing.config;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.util.function.Consumer;
import java.util.function.IntPredicate;

/**
 * In development, when server.port is taken (another billing, a stale JVM, a Windows reserved range), picks
 * the next free port, up to {@link #MAX_ATTEMPTS}, and logs the move; StartupChecks puts the choice in
 * server.port before Tomcat starts. Production keeps the configured port and fails on a conflict, as the
 * API and the platform are configured with the exact address.
 * <p>
 * The port is probed, then released for Tomcat: another process could take it in between, which in
 * development only means a second restart.
 */
public final class DevPortFallback {

	static final int MAX_ATTEMPTS = 20;

	private DevPortFallback() {
	}

	/** the port to use: {@code configured} when free, else the next free one; -1 when none was free */
	static int choose(int configured, IntPredicate free, Consumer<String> log) {
		if (configured == 0 || free.test(configured)) { // 0 = a random port, nothing to do
			return configured;
		}
		for (int port = configured + 1; port <= 65535 && port - configured < MAX_ATTEMPTS; port++) {
			log.accept("[dev] port " + (port - 1) + " is unavailable; trying " + port);
			if (free.test(port)) {
				log.accept("[dev] port " + configured + " was unavailable; billing will listen on " + port
						+ " instead. Point the API's BILLING_URL at it.");
				return port;
			}
		}
		return -1;
	}

	/** true when a server socket can bind host:port right now */
	static boolean isFree(String host, int port) {
		try (ServerSocket socket = new ServerSocket()) {
			socket.setReuseAddress(false);
			InetAddress address = (host == null || host.isBlank()) ? null : InetAddress.getByName(host);
			socket.bind(address == null ? new InetSocketAddress(port) : new InetSocketAddress(address, port));
			return true;
		}
		catch (IOException ex) {
			return false;
		}
	}

}
