package com.simple_erp.billing.notification;

import com.simple_erp.billing.config.ErpProperties;
import com.simple_erp.billing.network.NetworkConfig.NetworkHolder;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.ssl.SslBundles;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.http.client.support.HttpRequestWrapper;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.client.RestClient;

@Configuration
@EnableScheduling
@EnableConfigurationProperties(ErpProperties.class)
class NotificationConfig {

	private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
	private static final Duration READ_TIMEOUT = Duration.ofSeconds(10);

	@Bean
	RestClient erpClient(ErpProperties erp, NetworkHolder network, SslBundles bundles) {
		// mutual TLS, TLS 1.3: billing shows its certificate (CN billing) and trusts only the internal CA, so the
		// API's certificate must be signed by it; the API checks the CN before opening /internal/billing
		HttpClient http = HttpClient.newBuilder()
				.connectTimeout(CONNECT_TIMEOUT)
				.sslContext(bundles.getBundle("internal").createSslContext())
				.build();
		JdkClientHttpRequestFactory requests = new JdkClientHttpRequestFactory(http);
		requests.setReadTimeout(READ_TIMEOUT);
		// with the network service the API is found by name ("api") on each call, wherever its port ended up;
		// ERP_API_URL is then only the fallback while no API instance is registered
		String fallback = erp.apiUrl() == null || erp.apiUrl().isBlank() ? "https://api.unresolved" : erp.apiUrl();
		return RestClient.builder()
				.baseUrl(fallback)
				.requestFactory(requests)
				.requestInterceptor((request, body, execution) -> {
					String found = network.client() == null ? null : network.client().address("api");
					if (found == null) {
						return execution.execute(request, body);
					}
					URI base = URI.create(found);
					URI original = request.getURI();
					URI target = URI.create(base.getScheme() + "://" + base.getRawAuthority() + original.getRawPath()
							+ (original.getRawQuery() == null ? "" : "?" + original.getRawQuery()));
					return execution.execute(new HttpRequestWrapper(request) {
						@Override
						public URI getURI() {
							return target;
						}
					}, body);
				})
				.build();
	}

}
