import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Firebase wiring is optional by design (TMDB setup-card philosophy): the google-services
// plugin only applies once you drop your real google-services.json into android/app/.
// CI (and colleague clones) build green without it; NotificationSkeleton stays local-lane only.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.svimranmy.seasonbook"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.svimranmy.seasonbook"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources.excludes += "META-INF/*"
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    // Compiles (and even runs, on-device, as a no-op) without google-services.json;
    // FCM activates once that file exists + apply plugin above kicks in.
    implementation("com.google.firebase:firebase-messaging:24.0.2")
    testImplementation("junit:junit:4.13.2")
}
