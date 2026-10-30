package com.simple_erp.billing;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.testcontainers.junit.jupiter.Testcontainers;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(properties = { "stripe.api-key=rk_test_unit", "stripe.webhook-secret=whsec_unit_test" })
@Testcontainers(disabledWithoutDocker = true)
class BillingApplicationTests {

	@Test
	void contextLoads() {
	}

}
