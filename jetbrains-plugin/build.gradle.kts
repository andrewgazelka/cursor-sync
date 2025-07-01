plugins {
  id("java")
  id("org.jetbrains.kotlin.jvm") version "1.9.25"
  id("org.jetbrains.intellij.platform") version "2.6.0"
}

group = "com.andrewgazelka"
version = "1.0-SNAPSHOT"

repositories {
  mavenCentral()
  
  // IntelliJ Platform Plugin repositories
  intellijPlatform {
    defaultRepositories()
  }
}

dependencies {
  implementation("org.java-websocket:Java-WebSocket:1.5.4")
  implementation("com.google.code.gson:gson:2.10.1")
  
  // IntelliJ Platform dependencies
  intellijPlatform {
    intellijIdeaCommunity("2024.2")
    
    pluginVerifier()
    zipSigner()
  }
}

// Configure IntelliJ Platform Plugin
intellijPlatform {
  pluginConfiguration {
    version = project.version.toString()
    
    ideaVersion {
      sinceBuild = "242"
      untilBuild = "261.*"
    }
  }
  
  signing {
    certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
    privateKey = providers.environmentVariable("PRIVATE_KEY")
    password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
  }
  
  publishing {
    token = providers.environmentVariable("PUBLISH_TOKEN")
  }
}

tasks {
  // Set the JVM compatibility versions
  withType<JavaCompile> {
    sourceCompatibility = "21"
    targetCompatibility = "21"
  }
  withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
    kotlinOptions.jvmTarget = "21"
  }
}