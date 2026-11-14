package com.simple_erp.billing.config;

import java.io.IOException;
import java.security.cert.X509Certificate;

import javax.naming.InvalidNameException;
import javax.naming.ldap.LdapName;
import javax.naming.ldap.Rdn;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * /internal/** is the Node API's door into billing (Stripe status, events, cobranças). Billing serves TLS 1.3
 * and asks every client for a certificate signed by the internal CA (BILLING_TLS_CA; server.ssl.client-auth=want,
 * so the Stripe CLI and health checks still connect without one). Here a request to /internal/** must have come
 * with one whose CN is "api"; anything else is a 401. No shared token any more.
 */
public final class ClientCertificateFilter extends OncePerRequestFilter {

	static final String PREFIX = "/internal/";

	private final String expectedCn;

	public ClientCertificateFilter(String expectedCn) {
		this.expectedCn = expectedCn;
	}

	// The servlet path, not the request URI: behind the launcher's gateway, X-Forwarded-Prefix turns the URI
	// into /billing/internal/..., which a URI check would skip while Spring Security's /internal/** rule
	// (matched on the servlet path) still let it through.
	@Override
	protected boolean shouldNotFilter(HttpServletRequest request) {
		return !request.getServletPath().startsWith(PREFIX);
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		X509Certificate[] chainCerts = (X509Certificate[]) request.getAttribute("jakarta.servlet.request.X509Certificate");
		if (chainCerts == null || chainCerts.length == 0 || !this.expectedCn.equals(commonName(chainCerts[0]))) {
			response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
			response.setContentType(MediaType.APPLICATION_JSON_VALUE);
			response.getWriter()
				.write("{\"message\":\"certificado de cliente inválido (esperado CN=" + this.expectedCn + ")\",\"status\":\"error\"}");
			return;
		}
		chain.doFilter(request, response);
	}

	static String commonName(X509Certificate cert) {
		try {
			for (Rdn rdn : new LdapName(cert.getSubjectX500Principal().getName()).getRdns()) {
				if (rdn.getType().equalsIgnoreCase("CN")) {
					return String.valueOf(rdn.getValue());
				}
			}
		} catch (InvalidNameException e) {
			return null;
		}
		return null;
	}

}
