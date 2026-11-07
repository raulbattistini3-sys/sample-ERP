package com.simple_erp.billing.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * /internal/** is the Node API's door into billing (Stripe status, events, cobranças). It carries the same
 * BILLING_INTERNAL_TOKEN billing already sends the API, as {@code Authorization: Bearer <token>}; anything
 * else is a 401. Compared in constant time, so the response time doesn't leak how much of a guess matched.
 */
public final class InternalTokenFilter extends OncePerRequestFilter {

	static final String PREFIX = "/internal/";

	private final byte[] expected;

	public InternalTokenFilter(String token) {
		this.expected = ("Bearer " + token).getBytes(StandardCharsets.UTF_8);
	}

	// The servlet path, not the request URI: behind the launcher's gateway, X-Forwarded-Prefix turns the URI
	// into /billing/internal/..., which a URI check would skip while Spring Security's /internal/** rule
	// (matched on the servlet path) still let it through, unauthenticated.
	@Override
	protected boolean shouldNotFilter(HttpServletRequest request) {
		return !request.getServletPath().startsWith(PREFIX);
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		String header = request.getHeader("Authorization");
		if (header == null || !MessageDigest.isEqual(this.expected, header.getBytes(StandardCharsets.UTF_8))) {
			response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
			response.setContentType(MediaType.APPLICATION_JSON_VALUE);
			response.getWriter().write("{\"message\":\"token interno inválido\",\"status\":\"error\"}");
			return;
		}
		chain.doFilter(request, response);
	}

}
