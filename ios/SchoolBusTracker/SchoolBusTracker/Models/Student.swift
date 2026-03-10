import Foundation

struct Student: Codable, Identifiable {
    let id: String
    let firstName: String
    let lastName: String
    let grade: String?
    let schoolId: String?
    let routeId: String?
    let stopId: String?
    let parentId: String?
    let companyId: String?
    let school: SchoolInfo?
    let route: RouteInfo?
    let stop: StopInfo?
    let bus: BusInfo?

    var fullName: String {
        "\(firstName) \(lastName)"
    }
}

struct SchoolInfo: Codable, Identifiable {
    let id: String
    let name: String
}

struct RouteInfo: Codable, Identifiable {
    let id: String
    let name: String
}

struct StopInfo: Codable, Identifiable {
    let id: String
    let name: String
    let scheduledTime: String?
    let estimatedTime: String?
}

struct BusInfo: Codable, Identifiable {
    let id: String
    let busNumber: String
    let status: String?
}
