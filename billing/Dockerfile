# Billing image: built with Maven, runs the Spring Boot jar on a JRE
FROM maven:3.9-eclipse-temurin-21-alpine AS build
WORKDIR /app
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY src ./src
# test.skip, not skipTests: the tests need Docker and aren't part of the image
RUN mvn -B -q -Dmaven.test.skip=true package

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S billing && adduser -S billing -G billing
COPY --from=build /app/target/billing-*.jar ./app.jar
USER billing
EXPOSE 8081
# 127.0.0.1, not localhost: busybox wget can resolve that to ::1 first
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=6 \
  CMD wget -qO- http://127.0.0.1:8081/actuator/health | grep -q UP
ENTRYPOINT ["java", "-jar", "app.jar"]
