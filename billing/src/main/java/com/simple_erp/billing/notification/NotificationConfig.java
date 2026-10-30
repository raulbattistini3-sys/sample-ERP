package com.simple_erp.billing.notification;

import com.simple_erp.billing.config.ErpProperties;
import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.client.RestClient;

@Configuration
@EnableScheduling
@EnableConfigurationProperties(ErpProperties.class)
class NotificationConfig {

	private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
	private static final Duration READ_TIMEOUT = Duration.ofSeconds(10);

	@Bean
	RestClient erpClient(ErpProperties erp) {
		HttpClient http = HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build();
		JdkClientHttpRequestFactory requests = new JdkClientHttpRequestFactory(http);
		requests.setReadTimeout(READ_TIMEOUT);
		return RestClient.builder()
				.baseUrl(erp.apiUrl())
				.requestFactory(requests)
				.defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + erp.internalToken())
				.build();
	}

}
